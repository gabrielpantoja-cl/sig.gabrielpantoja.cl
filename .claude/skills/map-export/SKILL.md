---
name: map-export
description: Rules for the PNG map export (anexo de peritaje) in src/lib/map-export.ts — capture pipeline (tiles → overlayPane → CBR markers → frame), tainted-canvas/CORS handling, the 8 s Promise.race timeout, per-layer metadata card (cajetín) built in src/lib/export-metadata.ts, mandatory attributions and licence notices. Invoke BEFORE editing map-export.ts, export-metadata.ts, the export button/handler, or when a new layer must show up correctly in the exported PNG.
license: MIT
compatibility: claude-code, opencode
metadata:
  category: doctrine
  data-tier: B
---

## Source of truth

The code is the spec: read `src/lib/map-export.ts` end to end before changing
it. Pixel values (radii, fonts, paddings) live in the draw functions — never
copy them into docs or this skill, they drift. This file records only the
rules that are easy to break.

## Pipeline (by function name, not line number)

```
captureBaseCanvas
  ├─ drawTileLayersToCanvas   basemap tiles; one Image per tile (loadAndDrawTile)
  └─ drawOverlayPaneToCanvas  every <canvas> AND <img> in overlayPane, in DOM order
drawCbrMarkers                cluster bubbles + singleton pin sprite (cbrPinSvg)
drawFrame                     compass, scale bar, measurements, metadata card,
                              NDVI card, attribution strip
exportFilename / downloadCanvas
```

The whole capture runs inside `Promise.race` with `EXPORT_TIMEOUT_MS` (8 s):
a hung tile must never leave the perito without a file.

## Hard rules

1. **Capture what the user sees, in the order they see it.** The export does
   not impose layer order; it reads the overlayPane in DOM order, which
   `reorderOverlays()` (MapView) defines. A layer that looks wrong in the PNG
   is usually missing from `reorderOverlays`, not from the export.
2. **Opacity and visibility are honoured.** `drawOverlayPaneToCanvas` reads
   each element's computed `opacity`/`visibility`/`display`; a hidden layer
   must be hidden in the DOM, not just transparent in React state.
3. **Tiles: skip, don't abort.** Each tile is independent
   (`Promise.allSettled`); a failed tile is dropped, the export continues.
   Tile `<img>`s set `crossOrigin = 'anonymous'` BEFORE `src`.
4. **Overlays: a non-CORS remote image throws.** An `<img>` from another
   origin without `crossOrigin` would taint the canvas and break `toBlob`, so
   `drawOverlayPaneToCanvas` throws a readable error instead. The fix for a new
   remote raster is to serve it through our own route (same origin, like the
   ArcGIS proxies and `/api/{ndvi,relieve}`), not to catch the error.
5. **Wait for decode.** Images are `decode()`d before drawing; skip any that
   is incomplete or has `naturalWidth === 0`.
6. **`ctx.save()` / `ctx.restore()`** around every alpha/font/style change
   (use `try/finally`), or state leaks into the next element.
7. **Measure text** (`ctx.measureText`) before sizing any box; no fixed widths.

## Adding a layer to the export

- `LayerExportFlags` (map-export.ts) gets a `showX` flag; page.tsx passes it.
- `buildExportMetadata` (`src/lib/export-metadata.ts`, tested in
  `export-metadata.test.ts`) gets the cajetín entry: `title`, `details`,
  `color`, `shape: 'square' | 'line' | 'dot'`, matching the live legend.
- An `ATTRIBUTION_*` constant is pushed in the attribution strip when the
  flag is on. Attribution is not optional: official sources require it, the
  basemap's notice depends on the provider in use, and **Relieve's
  Copernicus licence notice is mandatory** (AGENTS.md).
- Rasters in the overlayPane (`L.ImageOverlay`) enter on their own through
  `drawOverlayPaneToCanvas` — only metadata and attribution need code.
- Never put PII in the PNG (cajetín, labels, filename): see `api-pii-review`.

## Verification

`npm test -- export-metadata` and `npm run typecheck`; then a real export in
the browser with the new layer on and off, at two zooms, checking order,
opacity, legend entry and attribution.
