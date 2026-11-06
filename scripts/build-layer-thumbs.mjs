#!/usr/bin/env node
/**
 * Miniaturas del catálogo de capas (`public/layer-thumbs/<capa>.webp`).
 *
 * Cada miniatura es una captura REAL del SIG con una sola capa encendida,
 * sobre el fondo neutro y en un encuadre donde la capa se lee bien. Así la
 * vista previa del panel nunca promete algo que la capa no dibuja, y el color
 * queda en la cartografía, no en la interfaz.
 *
 * Uso (con `npm run dev` corriendo; las capas CBR necesitan NEON_DATABASE_URL):
 *
 *   npm i --no-save playwright-core
 *   CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe" \
 *     node scripts/build-layer-thumbs.mjs [capa …]
 *
 * `sharp` viene con Next. Las capas remotas piden un PNG por viewport a los
 * servicios oficiales: una pasada son ~17 pedidos, nada que se acerque al
 * límite propio de 60 por minuto.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const BASE = process.env.SIG_URL ?? 'http://localhost:3000';
const OUT = path.resolve('public/layer-thumbs');
/** Tamaño final: 2× el de la fila (56×40 px CSS). */
const WIDTH = 112;
const HEIGHT = 80;
/** Recorte en la pantalla, misma proporción 7:5, lejos de los controles. */
const CLIP = { width: 420, height: 300 };

/**
 * capa (nombre del permalink) → encuadre `lat,lng,zoom`. El nombre del archivo
 * es el id del catálogo (`layer-catalog.ts`), que es el que usa el panel.
 */
const THUMBS = {
  points: { capa: 'puntos', v: '-37.47,-72.35,10' },
  conservadores: { capa: 'conservadores', v: '-35.6,-71.6,7' },
  hexbins: { capa: 'mapa_calor', v: '-33.48,-70.68,10' },
  protected: { capa: 'areas_protegidas', v: '-40.45,-72.2,8' },
  urbanLimit: { capa: 'limite_urbano', v: '-38.73,-72.6,12' },
  comunas: { capa: 'comunas', v: '-36.9,-72.4,8' },
  redVial: { capa: 'red_vial', v: '-37.6,-72.3,10' },
  redDrenaje: { capa: 'red_drenaje', v: '-39.75,-72.9,10' },
  lineasTransmision: { capa: 'lineas_transmision', v: '-33.55,-70.8,9' },
  catastroFruticola: { capa: 'catastro_fruticola', v: '-34.42,-70.95,11' },
  suelos: { capa: 'suelos', v: '-36.62,-72.1,11' },
  vegetacional: { capa: 'vegetacional', v: '-39.85,-73.05,11' },
  humedales: { capa: 'humedales', v: '-39.82,-73.25,12' },
  propiedadesRurales: { capa: 'propiedades_rurales', v: '-37.79,-72.33,13' },
  ndviVisual: { capa: 'ndvi_visual', v: '-34.42,-70.95,12' },
  relieve: { capa: 'relieve', v: '-33.4,-70.3,11' },
  bioclima: { capa: 'bioclima', v: '-36.5,-71.5,6' },
};

const { chromium } = await import('playwright-core').catch(() => {
  console.error('Falta playwright-core: npm i --no-save playwright-core');
  process.exit(1);
});

const only = process.argv.slice(2);
const ids = only.length ? only : Object.keys(THUMBS);
const unknown = ids.filter((id) => !THUMBS[id]);
if (unknown.length) {
  console.error(`Capas desconocidas: ${unknown.join(', ')}`);
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });

for (const id of ids) {
  const { capa, v } = THUMBS[id];
  await page.goto(`${BASE}/?v=${v}&capas=${capa}&fondo=neutro`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.leaflet-container');
  // Fuera la pantalla de carga y todo control superpuesto al mapa.
  await page.waitForSelector('.sig-loader', { state: 'detached', timeout: 90_000 });
  await page.addStyleTag({
    content: '.leaflet-control-container, .sig-coordenadas { display: none !important; }',
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);

  const box = await page.locator('.leaflet-container').boundingBox();
  const clip = {
    x: Math.round(box.x + (box.width - CLIP.width) / 2),
    y: Math.round(box.y + (box.height - CLIP.height) / 2),
    ...CLIP,
  };
  const png = await page.screenshot({ clip });
  const file = path.join(OUT, `${id}.webp`);
  await sharp(png).resize(WIDTH, HEIGHT).webp({ quality: 82 }).toFile(file);
  console.log(`✓ ${id} → ${path.relative(process.cwd(), file)}`);
}

await browser.close();
