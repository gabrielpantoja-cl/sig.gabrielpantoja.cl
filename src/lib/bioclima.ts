/**
 * Bioclima — WORLDCLIM v2.1 (1981-2010)
 *
 * Raster de variables bioclimáticas: temperatura media anual, precipitación anual,
 * índices derivados. Backbone para análisis de nichos ecológicos, distribuciones de
 * especies, cambio climático.
 *
 * Datos: https://www.worldclim.org/data/worldclim21.html
 * - BIO1: Temp media anual (°C × 10)
 * - BIO12: Precip total anual (mm)
 * - Resolución: 2.5 min (~5 km)
 *
 * @see docs/roadmap.md § 5.1
 */

/**
 * Rango de valores esperados para Chile.
 * BIO1 (temp media): -2 a +20 °C → -20 a +200 en escala WORLDCLIM
 * BIO12 (precip): 50 a 4000 mm anuales
 */
export const bioclimaColorPalette = {
  // Temperatura (BIO1): divergente azul → rojo
  // Escala: -20 (frío extremo) → 0 (congelación) → 200 (cálido, 20°C)
  temperature: {
    ranges: [
      { min: -50, max: -20, color: '#1a237e', label: '< -2°C (extremo)' },
      { min: -20, max: 0, color: '#1565c0', label: '-2 a 0°C (frío)' },
      { min: 0, max: 50, color: '#42a5f5', label: '0 a 5°C' },
      { min: 50, max: 100, color: '#81c784', label: '5 a 10°C (templado)' },
      { min: 100, max: 150, color: '#fdd835', label: '10 a 15°C' },
      { min: 150, max: 200, color: '#ff7043', label: '15 a 20°C (cálido)' },
      { min: 200, max: 300, color: '#c62828', label: '> 20°C (muy cálido)' },
    ],
    label: 'Temperatura media anual',
    unit: '°C',
  },
  // Precipitación (BIO12): divergente azul oscuro → amarillo → rojo
  // Escala: 0 (desierto) → 2000 (templado) → 4000+ (húmedo)
  precipitation: {
    ranges: [
      { min: 0, max: 100, color: '#8b4513', label: '0–100 mm (desierto)' },
      { min: 100, max: 300, color: '#d2691e', label: '100–300 mm (árido)' },
      { min: 300, max: 600, color: '#f5deb3', label: '300–600 mm (semiárido)' },
      { min: 600, max: 1200, color: '#7cb342', label: '600–1200 mm (templado)' },
      { min: 1200, max: 2000, color: '#2e7d32', label: '1200–2000 mm' },
      { min: 2000, max: 3000, color: '#0277bd', label: '2000–3000 mm (húmedo)' },
      { min: 3000, max: 5000, color: '#01579b', label: '> 3000 mm (muy húmedo)' },
    ],
    label: 'Precipitación anual',
    unit: 'mm',
  },
};

/**
 * Configuración de capa para LayersControl.
 */
export const bioclimaLayerConfig = {
  name: 'Bioclima (WORLDCLIM)',
  shortName: 'Bioclima',
  className: 'bioclima',
  color: '#42a5f5',
  description: 'Temperatura media anual y precipitación total (1981-2010)',
  zIndex: 40,
  variable: 'precipitation' as const, // Default a precipitación; permite toggle
};

/**
 * Fetch GeoJSON de bioclima (stub mientras se descarga raster real).
 *
 * @throws Error si el archivo no existe o está vacío (investigación en curso).
 */
export async function fetchBioclima(): Promise<{
  type: 'FeatureCollection';
  features: unknown[];
  properties: { status: string };
}> {
  const res = await fetch('/data/bioclima.meta.json');
  if (!res.ok) {
    throw new Error(`fetchBioclima: ${res.status} ${res.statusText}`);
  }
  const meta = (await res.json()) as Record<string, unknown>;
  if (meta.estado === 'INVESTIGACIÓN') {
    console.warn(
      '⚠️  Capa Bioclima aún en investigación. Raster WORLDCLIM descargado pero no integrado en viewer.',
    );
  }
  return {
    type: 'FeatureCollection',
    features: [],
    properties: {
      status: 'INVESTIGACIÓN — raster no embebido aún',
    },
  };
}

/**
 * Información sobre la variable bioclimática seleccionada.
 */
export function bioclimaInfo(variable: 'temperature' | 'precipitation'): {
  label: string;
  unit: string;
  palette: (typeof bioclimaColorPalette)['temperature' | 'precipitation'];
} {
  const pal =
    variable === 'temperature'
      ? bioclimaColorPalette.temperature
      : bioclimaColorPalette.precipitation;
  return {
    label: pal.label,
    unit: pal.unit,
    palette: pal,
  };
}

/**
 * Atribución y descargo legal.
 *
 * @see docs/roadmap.md § 5.1
 */
export const bioclimaAttribution = `
© WORLDCLIM Project · Fick & Hijmans (2017) "WorldClim 2: new 1-km spatial resolution
climate surfaces for global land areas" International Journal of Climatology 37:4302-4315.

Datos: <a href="https://www.worldclim.org/" target="_blank">worldclim.org</a>
Licencia: <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank">CC-BY 4.0</a>

<strong>Nota:</strong> Climatología observada 1981-2010 (2.5 min, ~5 km).
Resolución gruesa para análisis predial fino; útil para contexto regional y análisis de nichos.
Para cambio climático futuro, ver proyecciones CMIP6 (Fase 5.5).
`.trim();
