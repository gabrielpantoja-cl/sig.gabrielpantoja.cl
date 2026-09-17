/**
 * Verificación de la serie NDVI contra testigos con comportamiento esperable.
 * Llama a la misma librería que usa `/api/ndvi/serie`, sin HTTP ni límite de
 * tasa. Fuera del build.
 *
 *   npx -y tsx scripts/research/ndvi-testigos.mts [etiqueta-salida]
 *
 * Los polígonos vienen del Catastro de Recursos Vegetacionales CONAF 2024 de
 * Los Ríos (MapServer USOS_DE_LA_TIERRA__CONAF, capa 12) y se guardan en
 * `.research/ndvi/poli-<objectid>.json`. La salida va a
 * `.research/ndvi/testigos-<etiqueta>.json` para comparar variantes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
// El repo no declara "type": "module", así que tsx compila la librería como
// CommonJS y sus exports con nombre llegan bajo `default` desde un .mts.
import * as ndviSerie from '@/lib/ndvi-serie';
const { calcularSerieNdvi } = ((ndviSerie as unknown as { default?: typeof ndviSerie }).default ?? ndviSerie);
import type { NdviGeometria, NdviSerie } from '@/lib/ndvi';

const poligono = (id: number): NdviGeometria => ({
  tipo: 'poligono',
  anillos: JSON.parse(readFileSync(`.research/ndvi/poli-${id}.json`, 'utf8')).anillos,
});

const CASOS: { clave: string; descripcion: string; geo: NdviGeometria }[] = [
  { clave: 'roble-3334', descripcion: 'Renoval puro de roble, Río Bueno (debe caer a fines de invierno)', geo: poligono(3334) },
  { clave: 'roble-14976', descripcion: 'Renoval puro de roble, La Unión (debe caer a fines de invierno)', geo: poligono(14976) },
  { clave: 'pino-11527', descripcion: 'Pino adulto, La Unión (curva casi plana)', geo: poligono(11527) },
  { clave: 'pino-17518', descripcion: 'Pino adulto, La Unión (plana hasta una cosecha 2026)', geo: poligono(17518) },
  { clave: 'cosecha-22052', descripcion: 'Pino «adulto» 2024, Lago Ranco (escalón por cosecha)', geo: poligono(22052) },
  { clave: 'costa', descripcion: 'Punto Cordillera de la Costa, Valdivia (nuboso)', geo: { tipo: 'punto', lat: -39.93, lng: -73.4, radio: 100 } },
  { clave: 'paillaco', descripcion: 'Punto valle de Paillaco (praderas)', geo: { tipo: 'punto', lat: -40.2, lng: -72.95, radio: 100 } },
  { clave: 'colchagua', descripcion: 'Punto valle de Colchagua (despejado, zona UTM 19)', geo: { tipo: 'punto', lat: -34.6, lng: -71.05, radio: 100 } },
];

const etiqueta = process.argv[2] ?? 'actual';
const salida: Record<string, NdviSerie> = {};
const inicio = Date.now();

// De a dos: cada serie abre decenas de lecturas COG concurrentes.
for (let i = 0; i < CASOS.length; i += 2) {
  await Promise.all(
    CASOS.slice(i, i + 2).map(async (caso) => {
      const serie = await calcularSerieNdvi(caso.geo, {
        signal: new AbortController().signal,
        presupuestoMs: 600_000,
      });
      salida[caso.clave] = serie;
      const ok = serie.meses.filter((m) => m.estado === 'ok');
      const prom = (meses: string[]) => {
        const v = ok.filter((m) => meses.includes(m.mes.slice(5))).map((m) => m.mediana!);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
      };
      console.log(
        `\n${caso.clave} — ${caso.descripcion}\n` +
          `  con dato ${serie.resumen.conDato}/36 · verano ${prom(['12', '01', '02']).toFixed(3)} · fin invierno ${prom(['07', '08', '09']).toFixed(3)} · ${(serie.resumen.ms / 1000).toFixed(0)} s\n` +
          `  ${serie.meses.map((m) => (m.estado === 'ok' ? m.mediana!.toFixed(2) : ' -- ')).join(' ')}`,
      );
    }),
  );
}

writeFileSync(`.research/ndvi/testigos-${etiqueta}.json`, JSON.stringify(salida));
console.log(`\nTotal ${((Date.now() - inicio) / 1000).toFixed(0)} s → .research/ndvi/testigos-${etiqueta}.json`);
