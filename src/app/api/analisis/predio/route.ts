import {
  corsHeaders,
  createRateLimiterWithRetry,
  enforce,
  rateLimitResponse,
} from '@/lib/security';
import { buildFilters } from '@/lib/filters';
import { getSql } from '@/lib/neon';
import {
  MAX_BODY_BYTES,
  MAX_COMPARABLES,
  holguraGrados,
  parseRadioM,
  validarPoligono,
  type AreasProtegidasPredio,
  type Comparable,
  type ComparablesDestino,
  type ComparablesPredio,
  type ComunaIntersectada,
  type FichaPredio,
  type FuenteCapa,
  type LimiteUrbanoPredio,
  type Seccion,
} from '@/lib/analisis-predio';

/**
 * POST /api/analisis/predio — ficha del predio: cruza el polígono del usuario
 * con las capas oficiales cargadas en PostGIS (esquema `capas`, ver
 * db/capas.sql y scripts/load-postgis.mjs) y con las transacciones CBR
 * cercanas. Contrato y validación en `src/lib/analisis-predio.ts`.
 *
 * Cuerpo: `{ "geometry": <GeoJSON Polygon|MultiPolygon> }`. Query string: los
 * mismos filtros que `/api/points` (`anio_min`, `sup_min`, …) más `radio_m`,
 * que acotan SOLO los comparables.
 *
 * Geodesia: todas las superficies y distancias se calculan en `geography`
 * (elipsoide WGS84), no en UTM, porque un predio puede caer en el huso 18 o 19
 * y una sola proyección no sirve para todo Chile. Las capas están troceadas
 * con ST_Subdivide: el área de una feature es la SUMA de sus trozos (que no se
 * solapan), por eso se agrupa por `fid`.
 *
 * Cada sección se consulta en paralelo y falla por separado: una capa aún no
 * cargada responde `sin-capa`, no 500. El polígono no se guarda ni se registra.
 * Privacidad: los comparables salen con la misma porción sin PII que
 * `/api/points`; nunca comprador, vendedor, RUT, userId ni observaciones.
 */

export const maxDuration = 30;

/** Presupuesto propio: cada ficha son varias intersecciones; 10 por minuto por IP. */
const limiteFicha = createRateLimiterWithRetry(60_000, 10);

/** Polígono del usuario reparado. `$1` es siempre el GeoJSON en texto. */
const PREDIO_CTE = `u AS (
  SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
           ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)), 3)) AS g
)`;

const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Tabla o esquema inexistente: la capa todavía no se cargó en PostGIS. */
function sinCapa(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === '42P01' || code === '3F000';
}

async function seccion<T>(nombre: string, consulta: () => Promise<T>): Promise<Seccion<T>> {
  try {
    return { estado: 'ok', datos: await consulta() };
  } catch (err) {
    if (sinCapa(err)) return { estado: 'sin-capa' };
    console.error(`[analisis/predio] ${nombre}:`, err instanceof Error ? err.message : err);
    return { estado: 'error' };
  }
}

const pct = (m2: number, totalM2: number) => (totalM2 > 0 ? Math.min(100, (m2 / totalM2) * 100) : 0);

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req, 'POST, OPTIONS') });
}

export async function POST(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;
  const espera = limiteFicha(req);
  if (espera > 0) return rateLimitResponse(req, espera, 'Too many parcel analyses in a short time.');
  const headers = { ...corsHeaders(req, 'POST, OPTIONS'), 'Cache-Control': 'no-store' };
  const fail = (status: number, message: string) => Response.json({ error: message }, { status, headers });

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return fail(413, 'El polígono es demasiado grande.');
    body = JSON.parse(text);
  } catch {
    return fail(400, 'El cuerpo debe ser JSON.');
  }
  const raw = body && typeof body === 'object' && 'geometry' in body ? (body as { geometry: unknown }).geometry : body;
  const validacion = validarPoligono(raw);
  if (!validacion.ok) return fail(422, validacion.error);

  const { searchParams } = new URL(req.url);
  const radioM = parseRadioM(searchParams.get('radio_m'));
  const geojson = JSON.stringify(validacion.geometry);
  const sql = getSql();

  try {
    const [base] = (await sql.query(
      `WITH ${PREDIO_CTE}
       SELECT ST_IsEmpty(g) AS vacio,
              ST_Area(g::geography) AS m2,
              ST_Perimeter(g::geography) AS perimetro,
              ST_X(ST_PointOnSurface(g)) AS lng,
              ST_Y(ST_PointOnSurface(g)) AS lat
       FROM u`,
      [geojson],
    )) as Record<string, unknown>[];
    if (!base || base.vacio === true || !(Number(base.m2) > 0)) {
      return fail(422, 'El polígono no encierra superficie una vez reparado (¿vértices repetidos o alineados?).');
    }
    const totalM2 = Number(base.m2);

    const comunas = seccion('comunas', async (): Promise<ComunaIntersectada[]> => {
      const rows = (await sql.query(
        `WITH ${PREDIO_CTE}
         SELECT c.cut_com, c.comuna, c.provincia, c.region,
                sum(ST_Area(ST_Intersection(c.geom, u.g)::geography)) AS m2
         FROM capas.comunas c, u
         WHERE ST_Intersects(c.geom, u.g)
         GROUP BY c.fid, c.cut_com, c.comuna, c.provincia, c.region
         ORDER BY m2 DESC`,
        [geojson],
      )) as Record<string, unknown>[];
      return rows.map((r) => ({
        cut: str(r.cut_com),
        comuna: str(r.comuna),
        provincia: str(r.provincia),
        region: str(r.region),
        ha: Number(r.m2) / 10_000,
        pct: pct(Number(r.m2), totalM2),
      }));
    });

    const limiteUrbano = seccion('limite_urbano', async (): Promise<LimiteUrbanoPredio> => {
      const rows = (await sql.query(
        `WITH ${PREDIO_CTE},
         i AS (
           SELECT l.fid, l.nombre, l.comuna, l.instrumento, l.publicacion_do,
                  ST_Intersection(l.geom, u.g) AS g
           FROM capas.limite_urbano l, u
           WHERE ST_Intersects(l.geom, u.g)
         )
         SELECT fid, nombre, comuna, instrumento, publicacion_do,
                sum(ST_Area(g::geography)) AS m2,
                -- Dos límites urbanos pueden solaparse (PRC + seccional): el
                -- total es el área de la UNIÓN, no la suma.
                (SELECT ST_Area(ST_Union(g)::geography) FROM i) AS total_m2
         FROM i
         GROUP BY fid, nombre, comuna, instrumento, publicacion_do
         ORDER BY m2 DESC`,
        [geojson],
      )) as Record<string, unknown>[];
      const urbanoM2 = rows.length > 0 ? Number(rows[0].total_m2) : 0;
      return {
        ha: urbanoM2 / 10_000,
        pct: pct(urbanoM2, totalM2),
        instrumentos: rows.map((r) => ({
          nombre: str(r.nombre),
          comuna: str(r.comuna),
          instrumento: str(r.instrumento),
          publicacionDo: str(r.publicacion_do),
          ha: Number(r.m2) / 10_000,
        })),
      };
    });

    const areasProtegidas = seccion('areas_protegidas', async (): Promise<AreasProtegidasPredio> => {
      const rows = (await sql.query(
        `WITH ${PREDIO_CTE}
         SELECT a.fid, a.cod_rnap, a.nombre, a.designacion,
                sum(ST_Area(ST_Intersection(a.geom, u.g)::geography)) AS m2
         FROM capas.areas_protegidas a, u
         WHERE ST_Intersects(a.geom, u.g)
         GROUP BY a.fid, a.cod_rnap, a.nombre, a.designacion
         ORDER BY m2 DESC`,
        [geojson],
      )) as Record<string, unknown>[];
      const areas = rows.map((r) => ({
        codRnap: str(r.cod_rnap),
        nombre: str(r.nombre),
        designacion: str(r.designacion),
        ha: Number(r.m2) / 10_000,
        pct: pct(Number(r.m2), totalM2),
      }));
      if (areas.length > 0) return { areas, masCercana: null };

      // KNN `<->` ordena por distancia de cajas en GRADOS (rápido, con el
      // índice); entre los 20 trozos más cercanos se elige por la distancia
      // real en geography, que es la que se informa.
      const [cercana] = (await sql.query(
        `WITH ${PREDIO_CTE},
         cand AS (
           SELECT a.nombre, a.designacion, a.geom
           FROM capas.areas_protegidas a, u
           ORDER BY a.geom <-> u.g
           LIMIT 20
         )
         SELECT nombre, designacion, ST_Distance(cand.geom::geography, u.g::geography) AS d
         FROM cand, u
         ORDER BY d
         LIMIT 1`,
        [geojson],
      )) as Record<string, unknown>[];
      return {
        areas,
        masCercana: cercana
          ? { nombre: str(cercana.nombre), designacion: str(cercana.designacion), distanciaM: Number(cercana.d) }
          : null,
      };
    });

    const comparables = seccion('comparables', async (): Promise<ComparablesPredio> => {
      // Filtros compartidos ($1..$k) primero; los parámetros propios se apilan
      // después, igual que en /api/hexbins.
      const { where, params } = buildFilters(searchParams);
      const push = (value: string | number): string => {
        params.push(value);
        return `$${params.length}`;
      };
      const { dLng, dLat } = holguraGrados(validacion.geometry, radioM);
      const pGeo = push(geojson);
      const pDLng = push(dLng);
      const pDLat = push(dLat);
      const pRadio = push(radioM);

      const [row] = (await sql.query(
        `WITH u AS (
           SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
                    ST_SetSRID(ST_GeomFromGeoJSON(${pGeo}), 4326)), 3)) AS g
         ),
         r AS (
           SELECT lat, lng, monto, "montoUf", anio, comuna, predio,
                  "superficieTerreno" AS superficie, rol, destino,
                  fechaescritura::text AS "fechaEscritura",
                  "fechaInscripcion"::text AS "fechaInscripcion",
                  fojas, numero, "conservadorId",
                  ST_Distance(geom::geography, u.g::geography) AS dist
           FROM referenciales, u
           WHERE ${where}
             -- Prefiltro con el índice GiST (grados), luego el radio exacto.
             AND geom && ST_Expand(u.g, ${pDLng}, ${pDLat})
             AND ST_DWithin(geom::geography, u.g::geography, ${pRadio})
         ),
         stats AS (
           SELECT destino,
                  count(*)::int AS n,
                  percentile_cont(0.5)  WITHIN GROUP (ORDER BY monto::float8 / superficie)
                    FILTER (WHERE monto IS NOT NULL AND superficie > 0) AS mediana_ppm2,
                  percentile_cont(0.25) WITHIN GROUP (ORDER BY monto::float8 / superficie)
                    FILTER (WHERE monto IS NOT NULL AND superficie > 0) AS p25,
                  percentile_cont(0.75) WITHIN GROUP (ORDER BY monto::float8 / superficie)
                    FILTER (WHERE monto IS NOT NULL AND superficie > 0) AS p75,
                  percentile_cont(0.5)  WITHIN GROUP (ORDER BY superficie)
                    FILTER (WHERE superficie > 0) AS mediana_superficie,
                  percentile_cont(0.5)  WITHIN GROUP (ORDER BY monto) AS mediana_monto,
                  percentile_cont(0.5)  WITHIN GROUP (ORDER BY "montoUf") AS mediana_monto_uf
           FROM r
           GROUP BY destino
         ),
         cercanos AS (
           SELECT r.*, c.nombre AS conservador
           FROM r
           LEFT JOIN conservadores c ON c.id = r."conservadorId"
           ORDER BY r.dist
           LIMIT ${MAX_COMPARABLES}
         )
         SELECT (SELECT count(*)::int FROM r) AS total,
                (SELECT coalesce(json_agg(stats ORDER BY n DESC), '[]'::json) FROM stats) AS stats,
                (SELECT coalesce(json_agg(cercanos ORDER BY dist), '[]'::json) FROM cercanos) AS puntos`,
        params,
      )) as Record<string, unknown>[];

      const porDestino: ComparablesDestino[] = ((row?.stats ?? []) as Record<string, unknown>[]).map((s) => ({
        destino: str(s.destino),
        n: Number(s.n),
        medianaPpm2: num(s.mediana_ppm2),
        p25Ppm2: num(s.p25),
        p75Ppm2: num(s.p75),
        medianaSuperficie: num(s.mediana_superficie),
        medianaMonto: num(s.mediana_monto),
        medianaMontoUf: num(s.mediana_monto_uf),
      }));
      const puntos: Comparable[] = ((row?.puntos ?? []) as Record<string, unknown>[]).map((p) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
        monto: num(p.monto),
        montoUf: num(p.montoUf),
        anio: num(p.anio),
        comuna: str(p.comuna),
        predio: str(p.predio),
        superficie: num(p.superficie),
        rol: str(p.rol),
        destino: str(p.destino),
        fechaEscritura: str(p.fechaEscritura),
        fechaInscripcion: str(p.fechaInscripcion),
        fojas: str(p.fojas),
        numero: num(p.numero),
        conservador: str(p.conservador),
        distanciaM: Number(p.dist),
      }));
      return { radioM, porDestino, puntos, total: Number(row?.total ?? 0) };
    });

    const fuentes = (async (): Promise<FuenteCapa[]> => {
      try {
        const rows = (await sql.query(
          `SELECT capa, fuente, licencia, descargado::text AS descargado, cargado::text AS cargado
           FROM capas.fuentes ORDER BY capa`,
        )) as Record<string, unknown>[];
        return rows.map((r) => ({
          capa: String(r.capa),
          fuente: String(r.fuente),
          licencia: str(r.licencia),
          descargado: str(r.descargado),
          cargado: str(r.cargado),
        }));
      } catch {
        return [];
      }
    })();

    const ficha: FichaPredio = {
      superficieHa: totalM2 / 10_000,
      perimetroM: Number(base.perimetro),
      centroide: { lat: Number(base.lat), lng: Number(base.lng) },
      comunas: await comunas,
      limiteUrbano: await limiteUrbano,
      areasProtegidas: await areasProtegidas,
      comparables: await comparables,
      fuentes: await fuentes,
    };
    return Response.json(ficha, { headers });
  } catch (error) {
    console.error('[analisis/predio] base:', error instanceof Error ? error.message : error);
    return fail(500, 'No se pudo analizar el predio.');
  }
}
