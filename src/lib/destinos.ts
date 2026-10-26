/**
 * Filtro de transacciones por destino SII (`destinos=H,W`).
 *
 * Es un parámetro distinto del `destino` del mapa de calor: aquel es UNO solo
 * y obligatorio (la mediana de $/m² no se mezcla entre destinos), este es una
 * selección múltiple y opcional sobre puntos, estadísticas y exportación. El
 * plural evita que un enlace con el mapa de calor encendido filtre los puntos
 * sin que el usuario lo haya pedido.
 *
 * Funciones puras, compartidas por `buildFilters` (servidor) y el permalink
 * (navegador), para que la API y la URL acepten exactamente lo mismo.
 */

/** Un código de destino es una letra mayúscula (`docs/estructura-catastral.md` § 3.2). */
const CODE_RE = /^[A-Z]$/;

/** La tabla oficial tiene 20 códigos: más que eso en una lista es basura. */
const MAX_CODES = 20;

/**
 * Lee `destinos` como lista de códigos: sin repetidos, ordenada y sin lo que
 * no sea una letra mayúscula. Nunca lanza; lo inválido se descarta código a
 * código, y una lista sin nada válido equivale a «sin filtro».
 */
export function parseDestinos(raw: string | null): string[] {
  if (!raw) return [];
  const codes = new Set<string>();
  for (const part of raw.split(',')) {
    const code = part.trim();
    if (CODE_RE.test(code)) codes.add(code);
  }
  return [...codes].sort().slice(0, MAX_CODES);
}

/** Inverso de `parseDestinos`: la misma selección da siempre el mismo texto. */
export function serializeDestinos(codes: readonly string[]): string {
  return parseDestinos(codes.join(',')).join(',');
}

/** Agrega o quita un código de la selección, manteniéndola canónica. */
export function alternarDestino(codes: readonly string[], code: string): string[] {
  return codes.includes(code)
    ? codes.filter((c) => c !== code)
    : parseDestinos([...codes, code].join(','));
}

/**
 * Conteo por destino de la comuna elegida, o de todo el país con `todas`,
 * ordenado por frecuencia descendente (el selector pone arriba lo que la gente
 * va a elegir) y por código en los empates. Viene de `facets.destinos`.
 */
export function destinosDisponibles(
  porComuna: Record<string, Record<string, number>> | undefined,
  comuna: string,
): { code: string; n: number }[] {
  if (!porComuna) return [];
  const totals = new Map<string, number>();
  const fuentes = comuna === 'todas' ? Object.values(porComuna) : [porComuna[comuna] ?? {}];
  for (const conteo of fuentes) {
    for (const [code, n] of Object.entries(conteo)) totals.set(code, (totals.get(code) ?? 0) + n);
  }
  return [...totals]
    .map(([code, n]) => ({ code, n }))
    .sort((a, b) => b.n - a.n || a.code.localeCompare(b.code));
}
