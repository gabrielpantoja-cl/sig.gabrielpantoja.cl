/**
 * Capa Catastro Frutícola de Chile — CIREN-ODEPA (IDE Minagri).
 *
 * Polígonos de los productores frutícolas levantados por CIREN con apoyo de
 * ODEPA, una capa por región de Chile (14 sublayers del grupo PRODUCTORES
 * FRUTÍCOLAS en el MapServer "CATASTRO_FRUTICOLA" del IDE Minagri). El dataset
 * identifica cada potrero/huerto por su ROL (mismo esquema que el ROL de los
 * puntos CBR — pivote para join en el cliente), comuna, región y hasta 4
 * especies declaradas. Dato público oficial (no es el producto empaquetado
 * "Cotizar" que vende CIREN: este es el servicio público MapServer).
 *
 * Cobertura rotativa: cada región se levanta cada ~5 años (CIREN 2019–2025
 * según región). El vintage del levantamiento se conserva en cada feature
 * (`vintage`) y se muestra en el popup y en la leyenda del panel.
 *
 * Estilo: relleno translúcido por especie predominante (paleta categórica
 * cálida que no colisiona con carmesí=CBR, verdes/azules=RNAP, ámbar=PRL,
 * violeta=red vial, gris=comunas) + borde fino del mismo tono. En el panel
 * se listan las 12 especies principales; el resto cae en un gris neutro.
 *
 * Generado por scripts/build-catastro-fruticola.mjs.
 */

/**
 * Propiedades de cada feature en catastro-fruticola.geojson. Nombres de la
 * fuente CIREN en minúsculas (los entrega así el servicio). El campo `vintage`
 * lo agrega el ETL parseando el nombre del layer — no viene del servicio.
 */
export interface CatastroFruticolaProps {
  desccomu: string | null; // nombre comuna (p. ej. "ARICA", "RANCAGUA")
  rolpredi: string | null; // ROL del predio (pivote con CBR)
  especie_01: string | null; // especie principal declarada
  especie_02: string | null; // especie secundaria
  especie_03: string | null; // especie terciaria
  especie_04: string | null; // especie cuaternaria
  regidere: string | null; // código región SUBDERE (15–13)
  comudere: string | null; // código comuna SUBDERE
  provdere: string | null; // código provincia SUBDERE
  vintage: number | null; // año CIREN del catastro regional (p. ej. 2024)
}

/**
 * Paleta categórica para las especies más comunes del catastro frutícola
 * chileno. Se asigna por especie predominante (`especie_01`); si no aparece en
 * la tabla, cae en un gris neutro. La elección de tonos (cálidos + verdes
 * agrícolas) evita colisión con las demás capas: carmesí=CBR, verdes/azules
 * RNAP, ámbar=límite urbano, violeta=red vial, gris pizarra=comunas.
 *
 * Las claves se normalizan (mayúsculas + trim) para tolerar variaciones de
 * mayúsculas/acento que el servicio CIREN a veces trae.
 */
const SPECIES_COLORS: { keys: string[]; color: string }[] = [
  { keys: ['UVA DE MESA', 'UVA VINIFERA', 'UVA VINÍFERA'], color: '#7c2d12' }, // vino
  { keys: ['PALTO', 'PALTOS', 'PALTA'], color: '#65a30d' }, // verde lima
  { keys: ['MANZANO', 'MANZANOS'], color: '#dc2626' }, // rojo manzana
  { keys: ['CEREZO', 'CEREZOS'], color: '#be185d' }, // rosa cerezo
  { keys: ['CÍTRICOS', 'CITRICOS', 'NARANJO', 'LIMONERO', 'MANDARINO'], color: '#f59e0b' }, // naranja
  { keys: ['ARÁNDANO', 'ARANDANO', 'ARÁNDANOS'], color: '#1e40af' }, // azul oscuro
  { keys: ['NOGAL', 'NOGALES', 'AVELLANO', 'AVELLANOS'], color: '#92400e' }, // marrón
  { keys: ['KIWI', 'K IWIS'], color: '#4d7c0f' }, // verde musgo
  { keys: ['DURAZNO', 'DURAZNOS', 'NECTARIN', 'NECTARINES'], color: '#fb923c' }, // durazno
  { keys: ['PERAL', 'PERALES', 'MEMBRILLO'], color: '#84cc16' }, // verde claro
  { keys: ['OLIVO', 'OLIVOS'], color: '#4d7c0f' }, // verde musgo (compartido con kiwi por tono agrícola)
  { keys: ['CIRUELO', 'CIRUELOS', 'DAMASCO'], color: '#9333ea' }, // ciruela
];

/** Color de una especie normalizada, con fallback gris. */
export function especieColor(especie: string | null | undefined): string {
  const e = (especie ?? '').trim().toUpperCase();
  if (!e) return '#94a3b8';
  for (const { keys, color } of SPECIES_COLORS) {
    if (keys.some((k) => k.toUpperCase() === e)) return color;
  }
  return '#94a3b8';
}

/** Lista legible de las especies de la paleta (para la leyenda del panel). */
export const CATASTRO_FRUTICOLA_LEGEND: { label: string; color: string }[] = [
  { label: 'Uva (mesa / vinífera)', color: '#7c2d12' },
  { label: 'Palto', color: '#65a30d' },
  { label: 'Manzano', color: '#dc2626' },
  { label: 'Cerezo', color: '#be185d' },
  { label: 'Cítricos', color: '#f59e0b' },
  { label: 'Arándano', color: '#1e40af' },
  { label: 'Nogal / Avellano', color: '#92400e' },
  { label: 'Kiwi', color: '#4d7c0f' },
  { label: 'Durazno / Nectarín', color: '#fb923c' },
  { label: 'Peral / Membrillo', color: '#84cc16' },
  { label: 'Ciruelo / Damasco', color: '#9333ea' },
  { label: 'Otra especie', color: '#94a3b8' },
];

export const CATASTRO_FRUTICOLA_ATTRIBUTION =
  'Fuente: CIREN — Catastro Frutícola (CIREN-ODEPA) · IDE Minagri';

export const CATASTRO_FRUTICOLA_SOURCE_URL =
  'https://esri.ciren.cl/portal/apps/sites/#/ciren-catastro-fruticola';

/** Une las especies declaradas en una cadena legible, omitiendo vacías. */
export function speciesList(p: CatastroFruticolaProps): string {
  const out: string[] = [];
  for (const k of ['especie_01', 'especie_02', 'especie_03', 'especie_04'] as const) {
    const v = (p[k] ?? '').trim();
    if (v) out.push(v);
  }
  return out.join(' · ');
}