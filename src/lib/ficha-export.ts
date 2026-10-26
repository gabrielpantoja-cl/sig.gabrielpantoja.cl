/**
 * Descargas de la ficha del predio, armadas en el navegador con lo que ya
 * respondió `/api/analisis/predio` (no hay otra consulta):
 *
 * - GeoJSON: el polígono analizado con el resumen de la ficha en sus
 *   propiedades, más los comparables como puntos. Abre directo en QGIS o
 *   ArcGIS y conserva la trazabilidad (fuentes, fecha de análisis).
 * - CSV de comparables: la tabla que el tasador pega en su informe. `;` como
 *   separador y BOM UTF-8, que es lo que Excel en español abre sin asistente.
 *
 * Los comparables traen la misma porción sin PII que `/api/points`.
 */

import type { Comparable, FichaPredio, PoligonoGeoJson } from '@/lib/analisis-predio';

const redondear = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function fichaAGeoJson(
  geometry: PoligonoGeoJson,
  ficha: FichaPredio,
  origen: string,
  generado: Date = new Date(),
) {
  const ok = <T,>(s: { estado: string; datos?: T }) => (s.estado === 'ok' ? s.datos ?? null : null);
  const comunas = ok(ficha.comunas);
  const urbano = ok(ficha.limiteUrbano);
  const protegidas = ok(ficha.areasProtegidas);
  const comparables = ok(ficha.comparables);
  const relieve = ok(ficha.relieve);

  const predio = {
    type: 'Feature' as const,
    geometry,
    properties: {
      tipo: 'predio',
      origen,
      generado: generado.toISOString(),
      superficie_ha: redondear(ficha.superficieHa, 4),
      perimetro_m: redondear(ficha.perimetroM, 1),
      comunas: comunas ? comunas.map((c) => c.comuna).filter(Boolean).join(', ') : null,
      urbano_pct: urbano ? redondear(urbano.pct, 2) : null,
      urbano_ha: urbano ? redondear(urbano.ha, 4) : null,
      areas_protegidas: protegidas
        ? protegidas.areas.map((a) => `${a.nombre} (${redondear(a.pct, 2)} %)`).join('; ') || null
        : null,
      area_protegida_mas_cercana_m: protegidas?.masCercana ? Math.round(protegidas.masCercana.distanciaM) : null,
      pendiente_media_pct: relieve ? redondear(relieve.pendienteMedia, 1) : null,
      pendiente_sobre_30_pct: relieve ? redondear(relieve.pctSobre30, 2) : null,
      pendiente_sobre_45_pct: relieve ? redondear(relieve.pctSobre45, 2) : null,
      cota_min_m: relieve ? Math.round(relieve.cotaMin) : null,
      cota_max_m: relieve ? Math.round(relieve.cotaMax) : null,
      comparables_radio_m: comparables?.radioM ?? null,
      comparables_total: comparables?.total ?? null,
      fuentes: ficha.fuentes.map((f) => `${f.fuente}${f.descargado ? ` (${f.descargado})` : ''}`).join('; '),
      aviso: 'Análisis referencial. La superficie legal es la del plano o el título; los comparables son inscripciones, no una tasación.',
    },
  };

  const puntos = (comparables?.puntos ?? []).map((p) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    properties: { tipo: 'comparable', ...sinCoordenadas(p), distancia_m: Math.round(p.distanciaM) },
  }));

  return { type: 'FeatureCollection' as const, features: [predio, ...puntos] };
}

function sinCoordenadas(p: Comparable) {
  const { lat: _lat, lng: _lng, distanciaM: _d, ...resto } = p;
  void _lat;
  void _lng;
  void _d;
  return resto;
}

const COLUMNAS: [keyof Comparable | 'pesos_m2', string][] = [
  ['distanciaM', 'distancia_m'],
  ['destino', 'destino'],
  ['anio', 'anio'],
  ['fechaEscritura', 'fecha_escritura'],
  ['fechaInscripcion', 'fecha_inscripcion'],
  ['comuna', 'comuna'],
  ['predio', 'predio'],
  ['rol', 'rol'],
  ['superficie', 'superficie_m2'],
  ['monto', 'monto_clp'],
  ['montoUf', 'monto_uf'],
  ['pesos_m2', 'pesos_m2'],
  ['conservador', 'conservador'],
  ['fojas', 'fojas'],
  ['numero', 'numero'],
  ['lat', 'lat'],
  ['lng', 'lng'],
];

/** Celda CSV: comillas si trae separador, comillas o salto; neutraliza fórmulas de Excel. */
function celda(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function comparablesACsv(ficha: FichaPredio): string {
  const puntos = ficha.comparables.estado === 'ok' ? ficha.comparables.datos.puntos : [];
  const filas = [COLUMNAS.map(([, h]) => h).join(';')];
  for (const p of puntos) {
    filas.push(
      COLUMNAS.map(([k]) => {
        if (k === 'pesos_m2') return celda(p.monto !== null && p.superficie ? Math.round(p.monto / p.superficie) : null);
        if (k === 'distanciaM') return celda(Math.round(p.distanciaM));
        return celda(p[k]);
      }).join(';'),
    );
  }
  return `﻿${filas.join('\r\n')}\r\n`;
}
