import { enforce, corsHeaders } from '@/lib/security';
import { buildFilters } from '@/lib/filters';
import { getSql } from '@/lib/neon';
import {
  DESTINO_DEFAULT,
  HEXBIN_MAX_CELLS,
  HEXBIN_MIN_N_DEFAULT,
  HEXBIN_MIN_N_MAX,
  hexEdgeForZoom,
  type HexbinProps,
} from '@/lib/hexbins';

/**
 * GET /api/hexbins — agregación hexagonal de $/m² para el mapa de calor de valor.
 *
 * Devuelve un FeatureCollection de PUNTOS — el centroide de cada celda de una
 * malla hexagonal (`ST_HexagonGrid`, PostGIS 3.3) — con la MEDIANA de
 * `monto / superficieTerreno` de la celda, más P25/P75 y el conteo.
 *
 * La malla hexagonal no se dibuja: es la retícula de MUESTREO. El cliente
 * interpola esos centroides con un kernel gaussiano
 * (`src/lib/heat-surface.ts`) para producir una superficie continua. La
 * agregación corre en Neon: el navegador recibe cientos de muestras, no 85k
 * puntos.
 *
 * El orden importa: primero la MEDIANA por celda (robusta a los montos
 * extremos) y recién después el suavizado. Interpolar los puntos crudos
 * dejaría que una sola inscripción anómala tiñera un barrio entero.
 *
 * El truco de rendimiento es el `JOIN LATERAL ST_HexagonGrid(edge, pts.g)`
 * **por punto**: la malla se genera únicamente sobre la envolvente de cada
 * transacción (un hexágono), así que el costo es O(transacciones del bbox) y
 * NO O(área del viewport). Un bbox nacional con celdas de 100 m no explota.
 *
 * Privacidad: la consulta solo toca `lat`, `lng`, `monto`, `superficieTerreno`
 * y `destino`. Las columnas PII (`comprador`, `vendedor`, `rut`, `userId`,
 * `observaciones`) no se seleccionan ni se filtran por ellas, y la salida es
 * agregada. Ver `docs/plan-mapa-de-calor.md`.
 */

/** Amplitud máxima del bbox en grados: descarta peticiones de escala mundial. */
const MAX_BBOX_SPAN_DEG = 40;

function parseBbox(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (east - west > MAX_BBOX_SPAN_DEG || north - south > MAX_BBOX_SPAN_DEG) return null;
  return [west, south, east, north];
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** El destino es un código SII de una sola letra; cualquier otra cosa se rechaza. */
function parseDestino(raw: string | null): string | null {
  if (!raw) return DESTINO_DEFAULT;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]$/.test(code) ? code : null;
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;
  const headers = corsHeaders(req);

  const { searchParams } = new URL(req.url);
  const bbox = parseBbox(searchParams.get('bbox'));
  const destino = parseDestino(searchParams.get('destino'));
  if (!bbox || !destino) {
    return Response.json({ error: 'Invalid bbox or destino' }, { status: 400, headers });
  }

  const zoom = clampInt(searchParams.get('z'), 12, 0, 22);
  const edgeM = hexEdgeForZoom(zoom);
  const minN = clampInt(searchParams.get('min_n'), HEXBIN_MIN_N_DEFAULT, 1, HEXBIN_MIN_N_MAX);

  try {
    // Los filtros compartidos de la UI (comuna, año, monto, superficie, predio,
    // rol) ya vienen parametrizados como $1..$k; los parámetros propios de esta
    // ruta se apilan a continuación para no romper la numeración.
    const { where, params } = buildFilters(searchParams);
    const push = (value: string | number): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const [west, south, east, north] = bbox;
    const pWest = push(west);
    const pEast = push(east);
    const pSouth = push(south);
    const pNorth = push(north);
    const pDestino = push(destino);
    const pEdge = push(edgeM);
    const pMinN = push(minN);

    const sql = getSql();
    const rows = (await sql.query(
      `WITH pts AS (
         SELECT ST_Transform(ST_SetSRID(ST_MakePoint(lng, lat), 4326), 3857) AS g,
                monto::float8 / "superficieTerreno" AS ppm2,
                monto::float8 AS monto
         FROM referenciales
         WHERE ${where}
           AND monto IS NOT NULL
           AND "superficieTerreno" > 0
           AND destino = ${pDestino}
           AND lng BETWEEN ${pWest} AND ${pEast}
           AND lat BETWEEN ${pSouth} AND ${pNorth}
       )
       SELECT count(*)::int AS n,
              percentile_cont(0.5)  WITHIN GROUP (ORDER BY ppm2) AS mediana_ppm2,
              percentile_cont(0.25) WITHIN GROUP (ORDER BY ppm2) AS p25,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY ppm2) AS p75,
              percentile_cont(0.5)  WITHIN GROUP (ORDER BY monto) AS mediana_monto,
              -- Centroide, no el polígono: el cliente ya no dibuja teselas, usa
              -- cada celda como MUESTRA de una superficie interpolada. Mandar
              -- 7 vértices por celda que nadie va a dibujar era ~8× el payload.
              ST_X(ST_Transform(ST_Centroid(h.geom), 4326)) AS cx,
              ST_Y(ST_Transform(ST_Centroid(h.geom), 4326)) AS cy
       FROM pts
       JOIN LATERAL ST_HexagonGrid(${pEdge}, pts.g) h ON ST_Intersects(pts.g, h.geom)
       GROUP BY h.i, h.j, h.geom
       HAVING count(*) >= ${pMinN}
       ORDER BY count(*) DESC
       LIMIT ${HEXBIN_MAX_CELLS}`,
      params,
    )) as Record<string, unknown>[];

    let points = 0;
    const features = rows.map((r) => {
      const n = Number(r.n);
      points += n;
      const properties: HexbinProps = {
        n,
        mediana_ppm2: Number(r.mediana_ppm2),
        p25: Number(r.p25),
        p75: Number(r.p75),
        mediana_monto: r.mediana_monto != null ? Number(r.mediana_monto) : null,
      };
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [Number(r.cx), Number(r.cy)],
        },
        properties,
      };
    });

    return Response.json(
      {
        type: 'FeatureCollection',
        features,
        // Foreign members: la UI los usa para rotular la leyenda con la
        // resolución y el umbral realmente aplicados por el servidor.
        edge_m: edgeM,
        destino,
        min_n: minN,
        cells: features.length,
        points,
      },
      {
        headers: {
          ...headers,
          'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
        },
      },
    );
  } catch (error) {
    console.error('Error building hexbins:', error);
    return Response.json({ error: 'Failed to build hexbins' }, { status: 500, headers });
  }
}
