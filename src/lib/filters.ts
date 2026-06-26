/**
 * Builds a parameterized SQL WHERE clause from the request query string.
 *
 * Every user value is bound as a $N placeholder (never string-interpolated) to
 * keep the read-only API injection-safe. Shared by /api/points, /api/stats and
 * /api/export so all three filter identically.
 *
 * Supported params: comuna, anio_min, anio_max, monto_min, monto_max,
 * sup_min, sup_max (over superficieTerreno), predio (ILIKE), rol (ILIKE).
 *
 * NOTE: camelCase columns in the Neon table (e.g. "superficieTerreno") must be
 * double-quoted, otherwise Postgres folds them to lowercase and they vanish.
 */
export interface ParsedFilters {
  where: string;
  params: (string | number)[];
}

function intParam(sp: URLSearchParams, key: string): number | null {
  const v = sp.get(key);
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildFilters(sp: URLSearchParams): ParsedFilters {
  const conds: string[] = ['lat IS NOT NULL', 'lng IS NOT NULL'];
  const params: (string | number)[] = [];
  const push = (val: string | number): string => {
    params.push(val);
    return `$${params.length}`;
  };

  const comuna = sp.get('comuna');
  if (comuna && comuna !== 'todas') conds.push(`comuna = ${push(comuna)}`);

  const anioMin = intParam(sp, 'anio_min');
  if (anioMin != null) conds.push(`anio >= ${push(anioMin)}`);
  const anioMax = intParam(sp, 'anio_max');
  if (anioMax != null) conds.push(`anio <= ${push(anioMax)}`);

  const montoMin = intParam(sp, 'monto_min');
  if (montoMin != null) conds.push(`monto >= ${push(montoMin)}`);
  const montoMax = intParam(sp, 'monto_max');
  if (montoMax != null) conds.push(`monto <= ${push(montoMax)}`);

  const supMin = intParam(sp, 'sup_min');
  if (supMin != null) conds.push(`"superficieTerreno" >= ${push(supMin)}`);
  const supMax = intParam(sp, 'sup_max');
  if (supMax != null) conds.push(`"superficieTerreno" <= ${push(supMax)}`);

  const predio = sp.get('predio');
  if (predio && predio.trim()) conds.push(`predio ILIKE ${push(`%${predio.trim()}%`)}`);

  const rol = sp.get('rol');
  if (rol && rol.trim()) conds.push(`rol ILIKE ${push(`%${rol.trim()}%`)}`);

  return { where: conds.join(' AND '), params };
}
