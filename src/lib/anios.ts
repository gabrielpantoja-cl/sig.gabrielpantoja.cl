/**
 * Filtro de años de las transacciones CBR: rango «desde–hasta» sobre el año de
 * la fecha disponible (escritura; si falta, inscripción), el mismo criterio de
 * `anio_min`/`anio_max` en `src/lib/filters.ts`.
 *
 * `null` en cualquiera de los extremos significa «sin límite», nunca el año
 * mínimo de la base: el deslizador anterior dejaba `anio_min=1994` activo al
 * volver al tope, contaba como filtro y ensuciaba el permalink.
 *
 * El histograma sale de `facets.anios` (conteos por comuna y año, ~7 KB), así
 * que el rango ofrecido es el de la comuna elegida y no el del país.
 */

/** Conteos por año: `{ "2016": 1151, … }`. */
export type ConteoAnios = Record<string, number>;

export interface AnioConteo {
  anio: number;
  n: number;
}

export interface RangoAnios {
  desde: number | null;
  hasta: number | null;
}

/**
 * Años con transacciones para la comuna (o el país con `'todas'`), en orden.
 * Solo los años presentes: un registro aislado de 1994 no debe abrir 17 barras
 * vacías antes de 2012.
 */
export function aniosDisponibles(
  porComuna: Record<string, ConteoAnios> | undefined,
  comuna: string,
): AnioConteo[] {
  if (!porComuna) return [];
  const total = new Map<number, number>();
  const sumar = (conteo: ConteoAnios) => {
    for (const [anio, n] of Object.entries(conteo)) {
      const y = Number(anio);
      if (Number.isInteger(y) && n > 0) total.set(y, (total.get(y) ?? 0) + n);
    }
  };
  if (comuna === 'todas') {
    for (const conteo of Object.values(porComuna)) sumar(conteo);
  } else if (porComuna[comuna]) {
    sumar(porComuna[comuna]);
  }
  return [...total.entries()].sort((a, b) => a[0] - b[0]).map(([anio, n]) => ({ anio, n }));
}

/**
 * Cambia un extremo y mantiene el rango válido: si «desde» queda después de
 * «hasta», el otro extremo lo sigue (elegir 2020 como «desde» con «hasta» en
 * 2016 deja 2020–2020, no un rango vacío).
 */
export function cambiarExtremo(rango: RangoAnios, extremo: 'desde' | 'hasta', valor: number | null): RangoAnios {
  const r = { ...rango, [extremo]: valor };
  if (r.desde != null && r.hasta != null && r.desde > r.hasta) {
    if (extremo === 'desde') r.hasta = r.desde;
    else r.desde = r.hasta;
  }
  return r;
}

/**
 * Clic en la barra de un año: lo deja como único año; si ya era el único,
 * quita el filtro. Con Mayús (o un rango ya abierto) extiende el rango hasta
 * ese año.
 */
export function alternarAnio(rango: RangoAnios, anio: number, extender = false): RangoAnios {
  const { desde, hasta } = rango;
  if (desde === anio && hasta === anio) return { desde: null, hasta: null };
  if (extender && (desde != null || hasta != null)) {
    const ancla = desde ?? hasta!;
    return { desde: Math.min(ancla, anio), hasta: Math.max(ancla, anio) };
  }
  return { desde: anio, hasta: anio };
}

export function anioEnRango(rango: RangoAnios, anio: number): boolean {
  return (rango.desde == null || anio >= rango.desde) && (rango.hasta == null || anio <= rango.hasta);
}

export function hayFiltroAnios(rango: RangoAnios): boolean {
  return rango.desde != null || rango.hasta != null;
}

/** «2016», «2016–2020», «desde 2016», «hasta 2020» o `''` sin filtro. */
export function etiquetaAnios(rango: RangoAnios): string {
  const { desde, hasta } = rango;
  if (desde != null && hasta != null) return desde === hasta ? String(desde) : `${desde}–${hasta}`;
  if (desde != null) return `desde ${desde}`;
  if (hasta != null) return `hasta ${hasta}`;
  return '';
}

/** Suma de transacciones dentro del rango, para el resumen bajo el control. */
export function totalEnRango(anios: readonly AnioConteo[], rango: RangoAnios): number {
  return anios.reduce((acc, a) => acc + (anioEnRango(rango, a.anio) ? a.n : 0), 0);
}
