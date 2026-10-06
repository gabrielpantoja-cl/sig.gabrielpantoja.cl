import type { Stats } from '@/lib/types';
import { kmlDisplayName, type KmlLayer } from '@/lib/kml';
import type { LayerMetadataEntry } from '@/lib/map-export';
import { LINEAS_TRANSMISION_COLOR } from '@/lib/lineas-transmision';
import { HEXBINS_COLOR, destinoLabel, hexEdgeLabel, type HexbinStatus } from '@/lib/hexbins';
import { bioclimaRamp, type BioclimaVariable } from '@/lib/bioclima';

/**
 * Cajetín de trazabilidad legal del PNG exportado: qué filtros y qué capas
 * (con su fuente oficial) produjeron la imagen que va como anexo de un
 * informe de tasación. Lo que diga aquí tiene que describir con exactitud lo
 * que el mapa muestra.
 */

/** Símbolo que separa unidades monetarias en formato chileno. Las inputs de
 *  filtros vienen como strings; aquí las formateamos a CLP para el cajetín
 *  del PNG exportado (la idea es que el informe pericial vea un rango
 *  legible, no un número crudo de `?monto_min=10000000`). */
const fmtMoney = (raw: string): string | null => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(n);
};

const fmtIntPlain = (v: number): string => v.toLocaleString('es-CL');

/** Inputs para el cajetín de trazabilidad. Es una función pura (no tiene
 *  closures ni estado); ver `export-metadata.test.ts`. */
export type BuildMetadataInput = {
  showBioclima: boolean;
  bioclimaVariable: BioclimaVariable;
  showPoints: boolean;
  showProtected: boolean;
  showUrbanLimit: boolean;
  showComunas: boolean;
  showRedVial: boolean;
  showRedDrenaje: boolean;
  showLineasTransmision: boolean;
  showSuelos: boolean;
  showCatastroFruticola: boolean;
  showVegetacional: boolean;
  showPropiedadesRurales: boolean;
  showNdviVisual: boolean;
  showHexbins: boolean;
  hexbinStatus: HexbinStatus;
  comuna: string;
  anioFrom: number | null;
  fechaDesde: string;
  fechaHasta: string;
  montoMin: string;
  montoMax: string;
  supMin: string;
  supMax: string;
  predio: string;
  rol: string;
  stats: Stats | null;
  kmlLayers: KmlLayer[];
};

/** Construye las entradas del cajetín legal a partir del estado vigente de
 *  filtros y visibilidad de capas. Se llama al hacer click en «Exportar
 *  PNG» (no en cada keystroke), así que es OK que filtre un poco más de lo
 *  necesario: la captura es momentánea, el cajetín solo se usa en ese PNG.
 *
 *  Estructura del cajetín (cada entrada = un bloque con negrita + detalles):
 *  - Transacciones CBR (título con conteo de inscripciones en la selección)
 *  - Una entrada por cada capa vectorial activa con su fuente oficial
 *  - Una entrada por cada capa KML subida por el usuario */
export function buildExportMetadata(input: BuildMetadataInput): LayerMetadataEntry[] {
  const entries: LayerMetadataEntry[] = [];
  if (input.showBioclima) {
    entries.push({
      title: input.bioclimaVariable === 'temperature' ? 'Temperatura media anual (°C)' : 'Precipitación anual (mm)',
      color: bioclimaRamp[input.bioclimaVariable].stops[0].color,
      shape: 'square',
      details: 'WorldClim 2.1 · 1970–2000 · resolución 2,5′\nSuperficie interpolada; no medición del predio.',
    });
  }

  if (input.showPoints) {
    const filtrosLineas: string[] = [];
    if (input.comuna !== 'todas') filtrosLineas.push(`Comuna: ${input.comuna}`);
    if (input.anioFrom != null) filtrosLineas.push(`Año desde (fecha disponible): ${input.anioFrom}`);
    if (input.fechaDesde || input.fechaHasta) {
      filtrosLineas.push(`Fecha disponible: ${input.fechaDesde || 'sin mínimo'} – ${input.fechaHasta || 'sin máximo'}`);
    }

    const minD = fmtMoney(input.montoMin);
    const maxD = fmtMoney(input.montoMax);
    if (minD || maxD) {
      // Construimos el rango con strings pre-formateados para no anidar
      // template literals con backticks sueltos (riesgo de desbalance de
      // delimitadores en TSX strict).
      const left = minD ? `≥ ${minD}` : 'sin mínimo';
      const right = maxD ? `≤ ${maxD}` : 'sin máximo';
      filtrosLineas.push(`Monto: ${left} – ${right}`);
    }
    if (input.supMin) {
      const n = Number(input.supMin);
      if (Number.isFinite(n)) {
        filtrosLineas.push(`Superficie terreno ≥ ${n.toLocaleString('es-CL')} m²`);
      }
    }
    if (input.supMax) {
      const n = Number(input.supMax);
      if (Number.isFinite(n)) {
        filtrosLineas.push(`Superficie terreno ≤ ${n.toLocaleString('es-CL')} m²`);
      }
    }
    if (input.predio.trim()) filtrosLineas.push(`Predio contiene: «${input.predio.trim()}»`);
    if (input.rol.trim()) filtrosLineas.push(`ROL SII contiene: «${input.rol.trim()}»`);

    const count = input.stats?.count ?? 0;
    const details = [
      `${fmtIntPlain(count)} inscripciones en la selección`,
      ...filtrosLineas,
      'Fuente: Conservadores de Bienes Raíces de Chile',
    ].join('\n');
    entries.push({
      title: 'Transacciones CBR',
      details,
      color: '#e11d48', // carmesí — color de marca CBR (lib/cbr-points)
      shape: 'dot',
    });
  }

  // Capas temáticas activas: cada una aporta su fuente oficial + el color
  // y la forma que se ven en el mapa, para que la muestra del cajetín se
  // corresponda 1:1 con el polígono/línea/marker del mapa en vivo.
  if (input.showProtected) {
    entries.push({
      title: 'Áreas protegidas (RNAP)',
      details: 'Designaciones legales según categoría\nFuente: Ministerio del Medio Ambiente · CC0\nhttps://sig.mma.gob.cl/rnap/',
      color: '#10b981', // verde bosque, dominante de las categorías RNAP
      shape: 'square',
    });
  }
  if (input.showUrbanLimit) {
    entries.push({
      title: 'Límite urbano (PRC)',
      details: 'Planes Reguladores Comunales vigentes\nFuente: MINVU · IPT · geoide.minvu.cl',
      color: '#c2410c', // ámbar (URBAN_LIMIT_COLOR)
      shape: 'square',
    });
  }
  if (input.showComunas) {
    entries.push({
      title: 'Límites comunales (DPA 2023)',
      details: 'División Político-Administrativa referencial\nFuente: SUBDERE · geoportal.cl',
      color: '#475569', // pizarra (COMUNAS_COLOR)
      shape: 'square',
    });
  }
  if (input.showRedVial) {
    entries.push({
      title: 'Red caminera (MOP)',
      details: 'Red Vial Nacional + ROL de Vialidad (puede diferir de Google/OSM)\nFuente: Dirección de Vialidad · mapasvialidad.mop.gob.cl',
      color: '#7c3aed', // violeta (clase 'nacional' de ROAD_CLASS_GROUPS)
      shape: 'line',
    });
  }
  if (input.showRedDrenaje) {
    entries.push({
      title: 'Red de drenaje (DGA)',
      details: 'Ríos + esteros del Banco Nacional de Aguas\nFuente: DGA · MOP · CC-BY 4.0',
      color: '#0ea5e9', // cian (paleta drenaje)
      shape: 'line',
    });
  }
  if (input.showSuelos) {
    entries.push({
      title: 'Suelos agrológicos (CIREN)',
      details: 'Capacidad de uso I–VIII, 12 regiones (Atacama a Aysén)\nFuente: CIREN · esri.ciren.cl',
      color: '#ca8a04', // amarillo tierra (SUELOS_CLASSES aprox.)
      shape: 'square',
    });
  }
  if (input.showCatastroFruticola) {
    entries.push({
      title: 'Catastro frutícola (CIREN-ODEPA)',
      details: 'Productores frutícolas por especie; levantamientos regionales CIREN 2019–2025 (el año es la fecha del catastro, no de plantación)\nFuente: CIREN-ODEPA · IDE Minagri',
      color: '#be185d', // magenta (especie por defecto)
      shape: 'square',
    });
  }
  if (input.showLineasTransmision) {
    entries.push({
      title: 'Líneas de transmisión eléctrica',
      details:
        'Ejes referenciales por tensión; no representan servidumbres ni gravámenes prediales\n' +
        'Fuente: Ministerio de Energía · IDE Energía · CEN',
      color: LINEAS_TRANSMISION_COLOR,
      shape: 'line',
    });
  }
  if (input.showVegetacional) {
    entries.push({
      title: 'Recursos vegetacionales (CONAF)',
      details: 'Uso, subuso, estructura, cobertura y especies dominantes; actualización regional variable\nFuente: CONAF · IDE Minagri',
      color: '#15803d',
      shape: 'square',
    });
  }
  if (input.showPropiedadesRurales) {
    entries.push({ title: 'Propiedades rurales (CIREN)', details: 'Polígonos prediales y ROL referenciales; cobertura y vintage regionales heterogéneos. No acredita dominio ni deslindes legales.\nFuente: CIREN · IDE Minagri', color: '#dc2626', shape: 'square' });
  }
  if (input.showNdviVisual) {
    entries.push({
      title: 'NDVI Visual (Sentinel-2)',
      details:
        'Índice de vigor vegetal por viewport, escala -0,1 a 0,9; escenas de los últimos días con máscara SCL\n' +
        'Contiene datos modificados de Copernicus Sentinel vía Element 84 / AWS Open Data',
      color: '#3e8f49', // verde medio de la rampa (parada 0,7)
      shape: 'square',
    });
  }

  if (input.showHexbins) {
    // El cajetín debe declarar la resolución y el umbral REALES con los que se
    // dibujó el mapa que se está exportando: el mismo viewport con otro
    // `N_min` produce otro mapa, y un PNG sin esa nota es incitable a error en
    // un informe pericial.
    const st = input.hexbinStatus;
    const detalle =
      st.kind === 'ready'
        ? [
            `Hexágonos de ${hexEdgeLabel(st.meta.edge_m)} de arista · mínimo ${st.meta.min_n} transacciones por celda`,
            `${st.meta.cells.toLocaleString('es-CL')} celdas · ${st.meta.points.toLocaleString('es-CL')} transacciones agregadas`,
            `Destino SII: ${destinoLabel(st.meta.destino)}`,
          ].join('\n')
        : 'Sin celdas suficientes en la vista exportada';
    entries.push({
      title: 'Mapa de calor de valor ($/m² terreno)',
      details:
        `${detalle}\n` +
        'Superficie interpolada desde la mediana de $/m² de cada celda; color por cuantiles recalculados\n' +
        'sobre la vista. Señal de mercado, no tasación.\n' +
        'Fuente: elaboración propia sobre inscripciones de los Conservadores de Bienes Raíces',
      color: HEXBINS_COLOR,
      shape: 'square',
    });
  }

  // Capas KML del operador: usamos el alias del perito (`kmlDisplayName`),
  // que es lo que aparece ya en el popup del feature tras renombrarlo.
  // El color es el de la paleta asignada por `kmlColorFor` al subir la capa,
  // único por KML para que se distingan entre sí dentro de un mismo mapa.
  for (const kml of input.kmlLayers) {
    if (!kml.visible) continue;
    entries.push({
      title: `KML: ${kmlDisplayName(kml)}`,
      details: `${kml.featureCount} entidades vectoriales\nFuente: archivo local del operador (no publicado)`,
      color: kml.color,
      shape: 'square',
    });
  }

  return entries;
}
