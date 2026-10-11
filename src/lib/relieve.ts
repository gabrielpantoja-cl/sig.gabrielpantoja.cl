/**
 * Relieve — Copernicus DEM GLO-30 (pendiente, exposición, sombreado).
 *
 * Lógica pura compartida por el servidor (`relieve-raster.ts`, que lee los COG
 * y pinta el PNG por viewport) y la UI (leyenda, consulta del punto): modos,
 * clases y colores, geometría de las baldosas Copernicus y la derivación de
 * pendiente/exposición/sombreado. Sin Leaflet, sin `window`, sin red.
 *
 * Fuente: Copernicus DEM GLO-30 Public en AWS Open Data
 * (`s3://copernicus-dem-30m`), COG de 1° × 1° con píxel de 1″ (~30 m) y tres
 * overviews (×2, ×4, ×8). Verificado 2026-10-11: la baldosa `S40_00_W074_00`
 * cubre [-74, -40, -73, -39], 3600 × 3600 px en float32, baldosas internas
 * de 1024 px, sin nodata declarado (el mar NO tiene baldosa).
 *
 * Tres cosas que el usuario debe saber y la leyenda dice:
 * 1. **Es un modelo de SUPERFICIE (DSM)**, no del terreno: incluye árboles y
 *    edificios. En un bosque la cota es la del dosel y el borde del bosque
 *    aparece como un «talud» falso. La pendiente de un predio forestal se lee
 *    con eso en mente.
 * 2. **Resolución efectiva según el zoom**: a zoom bajo se calcula sobre un
 *    overview (60–240 m), y la pendiente sale SUAVIZADA (menor que la real).
 *    La consulta del punto siempre usa la resolución nativa de 30 m.
 * 3. Época TanDEM-X 2011–2015, cota ortométrica EGM2008, error vertical
 *    absoluto < 4 m (90 %).
 *
 * @see docs/roadmap.md § 1.4 (alternativa DEM libre) y cola #11
 */

/** Modos de la capa. El sombreado es el default: es el que se lee de un vistazo. */
export type RelieveModo = 'sombreado' | 'pendiente' | 'exposicion';
export const RELIEVE_MODOS: readonly RelieveModo[] = ['sombreado', 'pendiente', 'exposicion'];
export const RELIEVE_DEFAULT_MODO: RelieveModo = 'sombreado';
export const RELIEVE_MODO_LABEL: Record<RelieveModo, string> = {
  sombreado: 'Sombreado',
  pendiente: 'Pendiente',
  exposicion: 'Exposición',
};

export function esRelieveModo(valor: unknown): valor is RelieveModo {
  return typeof valor === 'string' && (RELIEVE_MODOS as readonly string[]).includes(valor);
}

/** Rutas same-origin. */
export const RELIEVE_EXPORT_URL = '/api/relieve/export';
export const RELIEVE_PUNTO_URL = '/api/relieve/punto';

/** Zoom mínimo: a z10 un viewport ancho ya toca ~6 baldosas (mismo umbral que NDVI). */
export const RELIEVE_MIN_ZOOM = 10;
export const RELIEVE_OPACITY = 0.75;

export const RELIEVE_SERVICE_NAME = 'Copernicus DEM GLO-30 (AWS Open Data)';
export const RELIEVE_SOURCE_URL = 'https://registry.opendata.aws/copernicus-dem/';
/** Aviso OBLIGATORIO de la licencia para datos adaptados (art. 6 b). */
export const RELIEVE_ATTRIBUTION =
  'Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH ' +
  '2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';
/** Descargo OBLIGATORIO de la licencia (art. 6 c), traducido como ella permite. */
export const RELIEVE_DESCARGO_LICENCIA =
  'Las organizaciones a cargo del programa Copernicus, por ley o por delegación, no incurren en ' +
  'responsabilidad alguna por el uso del Copernicus WorldDEM-30.';
export const RELIEVE_DESCARGO =
  'Modelo de superficie (DSM): incluye árboles y edificios. TanDEM-X 2011–2015, cota EGM2008, ' +
  'error vertical < 4 m. Referencial: no reemplaza un levantamiento topográfico.';

/* ---------- Clases y colores ---------- */

export type ClasePendiente = { clase: string; hasta: number; color: string; nombre: string; rango: string };

/**
 * Clases de pendiente simple (A–I) de la «Pauta para Estudio de Suelos» del
 * SAG (2011, rectificada, § 3.1.2, Tabla 2), en % — la referencia que esa
 * pauta fija para «uniformar los criterios» de los estudios agrológicos. La
 * tabla dice «> 60» para la I y deja el 60 exacto sin asignar: aquí es ≥ 60.
 *
 * Los cortes de 30, 45 y 60 % son además umbrales legales (DS 82/2010; Ley
 * 20.283 art. 2 N° 5: «bosque nativo de conservación y protección» en
 * pendientes ≥ 45 %; DL 701 art. 13), así que coinciden con lo que un perito
 * necesita marcar. A 30 m, las clases A–C (< 5 %) quedan dentro del ruido
 * del DEM (error relativo < 2 m): se distinguen como «casi plano», no entre sí.
 */
export const PENDIENTE_CLASES: readonly ClasePendiente[] = [
  { clase: 'A', hasta: 1, color: '#1a9850', nombre: 'Plano', rango: '< 1 %' },
  { clase: 'B', hasta: 3, color: '#66bd63', nombre: 'Ligeramente inclinado', rango: '1–3 %' },
  { clase: 'C', hasta: 5, color: '#a6d96a', nombre: 'Suavemente inclinado', rango: '3–5 %' },
  { clase: 'D', hasta: 8, color: '#d9ef8b', nombre: 'Moderadamente inclinado', rango: '5–8 %' },
  { clase: 'E', hasta: 15, color: '#fee08b', nombre: 'Fuertemente inclinado', rango: '8–15 %' },
  { clase: 'F', hasta: 30, color: '#fdae61', nombre: 'Ligeramente escarpado', rango: '15–30 %' },
  { clase: 'G', hasta: 45, color: '#f46d43', nombre: 'Moderadamente escarpado', rango: '30–45 %' },
  { clase: 'H', hasta: 60, color: '#d73027', nombre: 'Escarpado', rango: '45–60 %' },
  { clase: 'I', hasta: Infinity, color: '#7f0000', nombre: 'Muy escarpado', rango: '≥ 60 %' },
];

export const PENDIENTE_FUENTE =
  'Clases A–I: SAG, Pauta para Estudio de Suelos (2011), Tabla 2. 45 %: umbral del bosque nativo de ' +
  'conservación y protección (Ley 20.283, art. 2 N° 5).';

export function clasePendiente(pct: number): ClasePendiente {
  return PENDIENTE_CLASES.find((c) => pct < c.hasta) ?? PENDIENTE_CLASES[PENDIENTE_CLASES.length - 1];
}

export type SectorExposicion = { sigla: string; nombre: string; color: string };

/** Ocho sectores desde el norte, en sentido horario (rueda de color estándar). */
export const EXPOSICION_SECTORES: readonly SectorExposicion[] = [
  { sigla: 'N', nombre: 'norte', color: '#e41a1c' },
  { sigla: 'NE', nombre: 'noreste', color: '#ff7f00' },
  { sigla: 'E', nombre: 'este', color: '#ffd92f' },
  { sigla: 'SE', nombre: 'sureste', color: '#4daf4a' },
  { sigla: 'S', nombre: 'sur', color: '#17becf' },
  { sigla: 'SO', nombre: 'suroeste', color: '#377eb8' },
  { sigla: 'O', nombre: 'oeste', color: '#984ea3' },
  { sigla: 'NO', nombre: 'noroeste', color: '#f781bf' },
];
/** Bajo esta pendiente la exposición no significa nada: se dibuja como «plano». */
export const EXPOSICION_PLANO_PCT = 2;
export const EXPOSICION_PLANO_COLOR = '#bdbdbd';

/** Sector de un azimut (grados desde el norte, horario). */
export function sectorExposicion(azimut: number): SectorExposicion {
  const a = ((azimut % 360) + 360) % 360;
  return EXPOSICION_SECTORES[Math.round(a / 45) % 8];
}

/* ---------- Geometría de las baldosas Copernicus ---------- */

/** Píxel nativo en grados de latitud (1 segundo de arco). */
export const PIXEL_GRADOS = 1 / 3600;
/** Ancho nativo de una baldosa en píxeles: 3600 hasta 50° de latitud, 2400 entre 50° y 60°. */
export function anchoBaldosa(latSur: number): number {
  const borde = Math.min(Math.abs(latSur), Math.abs(latSur + 1));
  return borde >= 50 ? 2400 : 3600;
}

/** Nombre de la baldosa que contiene (lat, lng): la nombra su esquina SUROESTE. */
export function baldosaDe(lat: number, lng: number): { nombre: string; latSur: number; lngOeste: number } {
  const latSur = Math.floor(lat);
  const lngOeste = Math.floor(lng);
  const ns = latSur < 0 ? `S${String(-latSur).padStart(2, '0')}` : `N${String(latSur).padStart(2, '0')}`;
  const ew = lngOeste < 0 ? `W${String(-lngOeste).padStart(3, '0')}` : `E${String(lngOeste).padStart(3, '0')}`;
  return { nombre: `Copernicus_DSM_COG_10_${ns}_00_${ew}_00_DEM`, latSur, lngOeste };
}

export function urlBaldosa(nombre: string): string {
  return `https://copernicus-dem-30m.s3.amazonaws.com/${nombre}/${nombre}.tif`;
}

/** Metros de un grado de latitud (esfera de radio medio; error < 0,5 %). */
export const METROS_POR_GRADO = (6_371_008.8 * Math.PI) / 180;

/**
 * Nivel de la pirámide (0 = 30 m nativo, 1 = 60 m, 2 = 120 m, 3 = 240 m) para
 * un viewport cuyo píxel mide `metrosPixelSalida`: el más grueso que no sea
 * más grueso que el píxel de salida. Así la imagen nunca muestra bloques del
 * DEM, y el costo de lectura queda acotado por el tamaño del viewport.
 */
export function nivelPara(metrosPixelSalida: number): number {
  const nativo = PIXEL_GRADOS * METROS_POR_GRADO;
  let nivel = 0;
  while (nivel < 3 && nativo * 2 ** (nivel + 1) <= metrosPixelSalida) nivel++;
  return nivel;
}

/** Resolución efectiva legible de un nivel: «30 m», «60 m»… */
export function resolucionNivel(nivel: number): string {
  return `${30 * 2 ** nivel} m`;
}

/* ---------- Derivadas del terreno ---------- */

export type Gradiente = { dzdx: number; dzdy: number };

/**
 * Gradiente de Horn (el de GDAL y ArcGIS) sobre una ventana 3 × 3 de cotas
 * `z` (fila 0 = norte), con el tamaño de celda en metros. `dzdx` crece hacia
 * el este, `dzdy` hacia el norte.
 */
export function gradienteHorn(z: ArrayLike<number>, celdaX: number, celdaY: number): Gradiente {
  const [a, b, c, d, , f, g, h, i] = Array.from(z);
  const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * celdaX);
  const dzdy = ((a + 2 * b + c) - (g + 2 * h + i)) / (8 * celdaY);
  return { dzdx, dzdy };
}

/** Pendiente en % (100 × tan). */
export function pendientePct({ dzdx, dzdy }: Gradiente): number {
  return 100 * Math.hypot(dzdx, dzdy);
}

export function pendienteGrados(g: Gradiente): number {
  return (Math.atan(Math.hypot(g.dzdx, g.dzdy)) * 180) / Math.PI;
}

/**
 * Exposición: azimut (desde el norte, horario) hacia el que MIRA la ladera,
 * es decir, la dirección de máximo descenso. `null` si es plana.
 */
export function exposicionGrados({ dzdx, dzdy }: Gradiente): number | null {
  if (dzdx === 0 && dzdy === 0) return null;
  const az = (Math.atan2(-dzdx, -dzdy) * 180) / Math.PI;
  return (az + 360) % 360;
}

/** Iluminación del noroeste (315°) a 45° de altura: la convención cartográfica. */
const AZIMUT_SOL = (315 * Math.PI) / 180;
const ZENIT_SOL = (45 * Math.PI) / 180;

/**
 * Sombreado en [0, 1]; una ladera plana da cos(45°) ≈ 0,707. `exagerar`
 * multiplica las pendientes (solo para el sombreado, nunca para la pendiente
 * informada): a zoom bajo el overview aplana el relieve y sin él se ve chato.
 */
export function sombreado(g: Gradiente, exagerar = 1): number {
  const p = Math.atan(exagerar * Math.hypot(g.dzdx, g.dzdy));
  const az = Math.atan2(-g.dzdx, -g.dzdy);
  const valor =
    Math.cos(ZENIT_SOL) * Math.cos(p) + Math.sin(ZENIT_SOL) * Math.sin(p) * Math.cos(AZIMUT_SOL - az);
  return Math.max(0, Math.min(1, valor));
}

export const SOMBREADO_PLANO = Math.cos(ZENIT_SOL);

/**
 * Color RGBA del sombreado sobre el mapa base: lo plano queda TRANSPARENTE,
 * las sombras oscurecen y las laderas al sol aclaran. Así la capa se suma al
 * mapa base en vez de taparlo.
 */
export function rgbaSombreado(valor: number): [number, number, number, number] {
  if (valor < SOMBREADO_PLANO) {
    const t = (SOMBREADO_PLANO - valor) / SOMBREADO_PLANO;
    return [20, 24, 32, Math.round(Math.min(1, t * 1.15) * 200)];
  }
  const t = (valor - SOMBREADO_PLANO) / (1 - SOMBREADO_PLANO);
  return [255, 252, 240, Math.round(Math.min(1, t) * 120)];
}

export function hexARgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ---------- Paletas (PNG indexado) ---------- */

export type Rgba = readonly [number, number, number, number];
const TRANSPARENTE: Rgba = [0, 0, 0, 0];

/** Niveles de sombra y de luz del sombreado cuantizado (32 + 16 + transparente: más niveles no se distinguen y pesan). */
const NIVELES_SOMBRA = 32;
const NIVELES_LUZ = 16;

export const PALETA_SOMBREADO: readonly Rgba[] = [
  TRANSPARENTE,
  ...Array.from({ length: NIVELES_SOMBRA }, (_, k): Rgba => [20, 24, 32, Math.round(((k + 1) / NIVELES_SOMBRA) * 200)]),
  ...Array.from({ length: NIVELES_LUZ }, (_, k): Rgba => [255, 252, 240, Math.round(((k + 1) / NIVELES_LUZ) * 120)]),
];

/** Índice de `PALETA_SOMBREADO` para un valor de `sombreado()`. */
export function indiceSombreado(valor: number): number {
  const [, , , alfa] = rgbaSombreado(valor);
  if (alfa === 0) return 0;
  if (valor < SOMBREADO_PLANO) return Math.max(1, Math.round((alfa / 200) * NIVELES_SOMBRA));
  return NIVELES_SOMBRA + Math.max(1, Math.round((alfa / 120) * NIVELES_LUZ));
}

export const PALETA_PENDIENTE: readonly Rgba[] = [
  TRANSPARENTE,
  ...PENDIENTE_CLASES.map((c): Rgba => [...hexARgb(c.color), 255]),
];

export function indicePendiente(pct: number): number {
  const i = PENDIENTE_CLASES.findIndex((c) => pct < c.hasta);
  return 1 + (i < 0 ? PENDIENTE_CLASES.length - 1 : i);
}

/**
 * Exposición: el color se desvanece en las pendientes suaves (2–10 %), donde
 * el azimut es casi ruido del DEM; bajo 2 % es «plano» gris tenue. Sin esto,
 * un valle agrícola se ve como confeti de colores.
 */
const ALFAS_EXPOSICION = [90, 150, 210, 255];
const CORTES_EXPOSICION = [4, 6, 10];
export const PALETA_EXPOSICION: readonly Rgba[] = [
  TRANSPARENTE,
  ...EXPOSICION_SECTORES.flatMap((s) => ALFAS_EXPOSICION.map((a): Rgba => [...hexARgb(s.color), a])),
  [...hexARgb(EXPOSICION_PLANO_COLOR), 80],
];

export function indiceExposicion(azimut: number | null, pct: number): number {
  if (azimut === null || pct < EXPOSICION_PLANO_PCT) return PALETA_EXPOSICION.length - 1;
  const sector = EXPOSICION_SECTORES.indexOf(sectorExposicion(azimut));
  const nivel = CORTES_EXPOSICION.filter((corte) => pct >= corte).length;
  return 1 + sector * ALFAS_EXPOSICION.length + nivel;
}

/* ---------- Consulta del punto ---------- */

export type RelievePunto = {
  /** m s.n.m. (EGM2008). */
  cota: number;
  pendientePct: number;
  pendienteGrados: number;
  /** Azimut de la exposición, `null` si es plano. */
  exposicion: number | null;
};

const num = (valor: number, decimales: number) =>
  valor.toLocaleString('es-CL', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

export function formatoCota(m: number): string {
  return `${num(m, 0)} m s.n.m.`;
}

export function formatoPendiente(pct: number, grados: number): string {
  return `${num(pct, pct < 10 ? 1 : 0)} % (${num(grados, 1)}°)`;
}

export function formatoExposicion(azimut: number | null, pct: number): string {
  if (azimut === null || pct < EXPOSICION_PLANO_PCT) return 'Plano (sin exposición definida)';
  const s = sectorExposicion(azimut);
  return `${s.sigla} · ${num(azimut, 0)}° (ladera que mira al ${s.nombre})`;
}
