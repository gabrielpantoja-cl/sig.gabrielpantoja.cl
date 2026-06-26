import { enforce, corsHeaders } from '@/lib/security';
import { buildFilters } from '@/lib/filters';
import { getSql } from '@/lib/neon';

/**
 * GET /api/export?format=csv|geojson — downloads the filtered set.
 *
 * CSV: UTF-8 with BOM + ';' separator so Excel (Spanish locale) opens it cleanly;
 * montos are raw numbers (no thousands formatting) so spreadsheets can compute.
 * GeoJSON: a FeatureCollection of Point features, consumable directly in QGIS.
 *
 * Same column whitelist and same filters as /api/points — no PII ever.
 */

const MAX_ROWS = 120000;
// SELECT expression (maps the camelCase Neon column to a clean output key) and
// the output keys used for CSV headers / GeoJSON properties / row access.
const SELECT_EXPR =
  'lat, lng, monto, anio, comuna, predio, "superficieTerreno" AS superficie, rol, destino';
const COLUMNS = [
  'lat', 'lng', 'monto', 'anio', 'comuna', 'predio', 'superficie', 'rol', 'destino',
] as const;

function csvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  // Quote when the value contains the separator, quotes or newlines.
  if (/[;"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;
  const headers = corsHeaders(req);

  try {
    const { searchParams } = new URL(req.url);
    const format = (searchParams.get('format') || 'csv').toLowerCase();
    const { where, params } = buildFilters(searchParams);
    const sql = getSql();

    const rows = (await sql.query(
      `SELECT ${SELECT_EXPR}
       FROM referenciales
       WHERE ${where}
       ORDER BY anio DESC
       LIMIT ${MAX_ROWS}`,
      params,
    )) as Record<string, unknown>[];

    if (format === 'geojson') {
      const features = rows.map((r) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [Number(r.lng), Number(r.lat)],
        },
        properties: {
          monto: r.monto != null ? Number(r.monto) : null,
          anio: r.anio,
          comuna: r.comuna,
          predio: r.predio,
          superficie: r.superficie != null ? Number(r.superficie) : null,
          rol: r.rol,
          destino: r.destino,
        },
      }));
      const fc = { type: 'FeatureCollection' as const, features };
      return new Response(JSON.stringify(fc), {
        headers: {
          ...headers,
          'Content-Type': 'application/geo+json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="referenciales.geojson"',
        },
      });
    }

    // Default: CSV
    const BOM = '﻿';
    const head = COLUMNS.join(';');
    const body = rows
      .map((r) => COLUMNS.map((c) => csvCell(r[c])).join(';'))
      .join('\r\n');
    const csv = `${BOM}${head}\r\n${body}`;

    return new Response(csv, {
      headers: {
        ...headers,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="referenciales.csv"',
      },
    });
  } catch (error) {
    console.error('Error exporting:', error);
    return Response.json(
      { error: 'Failed to export' },
      { status: 500, headers },
    );
  }
}
