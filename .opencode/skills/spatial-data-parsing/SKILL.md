---
name: spatial-data-parsing
description: Rules for parsing and cleaning user-provided spatial data (KML, GeoJSON) in this Next.js SIG — file size caps, feature caps, name/color/style extraction, sanitization, displayName initialization, and the Web Worker migration roadmap. Invoke BEFORE editing src/lib/kml.ts, scripts/build-*.mjs, or any pipeline that consumes user uploads or external geo-datasets (MMA, MINVU, SUBDERE, MOP, DGA, CIREN-ODEPA).
license: MIT
compatibility: opencode
metadata:
  category: doctrine
  data-tier: A
---

## When to apply
- Adding a new file-type parser (currently `parseKmlFile`).
- Tightening budgets in `KML_MAX_FILE_MB` or `KML_MAX_FEATURES`.
- Wiring color/visibility/legend into the UI or the export cajetín.
- Preparing for Web Worker migration of the parser.
- Loading any external GeoJSON or KML into the map (always validate against the same rules).

## Hard limits (already in `src/lib/kml.ts`)
- **File size**: `KML_MAX_FILE_MB = 15`. Brazilian common-land-parcel KMLs are usually <2 MB; 15 MB is a defensive upper bound.
- **Feature count**: `KML_MAX_FEATURES = 5000` per parse. Above this we reject with an explicit message rather than OOM-ing the browser.
- **Bounding-box inflation**: when feeding `bounds.pad(0.02)` style logic (Gemini report § 2.3), extends bounds 2% of view size in each direction so thick lines / circles don't get clipped at the tile boundary.

## Canonical KML processing pipeline (today)

```
File (Blob)
  → extension check (.kmz → reject; .kml → accept)
  → text()  (file.text())
  → DOMParser  (XML — main thread only, no Worker currently)
  → @tmcw/togeojson  (kmlToGeoJson(dom))
  → hasGeometry filter (drop features with geometry === null)
  → KmlLayer
       { id: uuid, name, displayName: name, color: kmlColorFor(index),
         visible: true, featureCount, geojson }
```

`@tmcw/togeojson` returns:
- `Geometry | null` per feature — `null` is dropped by `hasGeometry`.
- `properties.name` may be **string** OR `{ '@type': 'html', value: '...' }` (when togeojson hit CDATA). Use `kmlPropText(value: unknown): string` to read it (defined in `src/lib/kml.ts`).
- `properties.description` is similar HTML handling required.

## Color assignment — IGNORE Google Earth's `<Style><color>`

The KML palette in `src/lib/kml.ts`:

```ts
const KML_COLORS = [
  '#7c3aed',  // violeta
  '#0ea5e9',  // celeste
  '#db2777',  // magenta
  '#b45309',  // café
  '#0d9488',  // verde azulado
  '#dc2626',  // rojo
];
export const kmlColorFor = (index: number): string =>
  KML_COLORS[index % KML_COLORS.length];
```

Rules:
- `kmlColorFor(index)` assigns one color per UPLOADED file in round-robin order.
- The index is **per-tour**, not per-session — ref-counted across multiple uploads so retries don't always land on the same color.
- The result is stored on the layer's `color` field and propagates to:
  - The LayersControl UI swatch.
  - The KML popup background.
  - The map-export cajetín swatch (`color: layer.color, shape: 'square'`).
- **Trust nothing from `<Style><color>`.** Google Earth writes `#AABBGGRR` (alpha-first), not the standard hex. We IGNORE this — palette wins.

## `displayName` convention (renombrable por el perito)

`KmlLayer.displayName` initializes to the cleaned filename (`file.name.replace(/\.kml$/i, '')`). The perito can rename in the sidebar via `InlineEditableKmlName` (defined in `src/components/LayersControl.tsx`).

The rename flows to:
- KML popup badge: `"Capa KML · {kmlDisplayName(layer)}"`.
- Map-export cajetín title: `KML: {kmlDisplayName(layer)}`.

Never overwrite `name` from the rename — fall back with `kmlDisplayName(layer) = layer.displayName.trim() || layer.name`.

## Helper for consumers

```ts
// src/lib/kml.ts
export const kmlDisplayName = (layer: KmlLayer): string =>
  layer.displayName.trim() || layer.name;
```

Always use `kmlDisplayName(layer)` for user-facing display — never raw `layer.name` or `layer.displayName`. This prevents the rename UI from being silently clobbered when the user types only whitespace.

## Web Worker migration roadmap (Gemini § 2.4)

Today the parser runs synchronously on the main thread via `DOMParser` + `@tmcw/togeojson`. With ~5 MB KML and the feature cap, latency is ~200–500 ms (acceptable).

**Migration trigger**: only when a parse takes >1 s OR the user reports a freeze on real-world KML. Premature worker-ification adds 50–200 ms of `postMessage` overhead with no win.

**Path**:
1. **Replace `DOMParser` with `@xmldom/xmldom`** inside the worker. `DOMParser` is NOT available in `WorkerGlobalScope` (Gemini § 2.4).
2. **Initialize the worker**:

```ts
const worker = new Worker(
  new URL('./parser.worker.ts', import.meta.url),
  { type: 'module' }
);
```

3. **Transfer result zero-copy**: `postMessage(parsedFeatureCollection, [buffer])` with `Comlink` wrappers to keep TypeScript ergonomics.
4. **Don't migrate the color/style logic** — keep `kmlColorFor` on the main thread.
5. **Migration rollout**: feature-flagged behind a check on `kmlBytes > 2 * 1024 * 1024` (then send to worker) so the synchronous path stays for small uploads.

## Anti-patterns

- Calling `new DOMParser()` inside a Web Worker (it throws).
- Using `JSON.parse(xml.outerHTML)` as a KML → GeoJSON shortcut — `togeojson` preserves FeatureCollection semantics and `name`/`description` typing.
- Trusting `properties.name` as a `string` — could be the HTML wrapper type. Always use `kmlPropText`.
- Letting `KmlLayer.name` flow to UI without going through `kmlDisplayName` — the rename for the perito gets clobbered on file re-upload.
- Trusting user-supplied colors from `<Style><IconStyle><color>...` — palette always wins.
- Reading `process.env.NEON_DATABASE_URL` in client code (server only).
- Letting `atob()` or `TextDecoder` blow up on a partial read — guard with try/catch and surface `«file.name»: <reason>`.

## Anti-pattern checklist before merging a parser change

1. [ ] File >15 MB rejected with clear Spanish error message that names the file.
2. [ ] KMZ (ZIP) detected and rejected with explanation pointing to .kml extraction.
3. [ ] KML uppercased/lowercased extension handled both ways (`endsWith('.kml')`).
4. [ ] XML malformed — `parsererror` selector surfaces user-friendly error, not `DOMException`.
5. [ ] Feature-less KML — `"no contiene geometrías (Placemarks)"` message.
6. [ ] >5,000 features rejected without OOM-ing the browser.
7. [ ] Counter `kmlColorCount` increments even on failed files (so retries don't land on the same color).
8. [ ] Error messages for multi-file uploads are joined with `\n` (one line per failed file).
9. [ ] Upload flow never exposes the user's file path or full file content — only the parsed `name`.
10. [ ] Lint passes — `name` and `displayName` are properly typed (no `any`).

## Reference files
- `src/lib/kml.ts` — parser + color palette + `KmlLayer` interface.
- `src/components/LayersControl.tsx:InlineEditableKmlName` — rename flow.
- `src/components/MapView.tsx:buildKmlPopup` — popup using `kmlDisplayName`.
- `src/app/page.tsx:buildExportMetadata` — KML entry in the cajetín (`kmlDisplayName(kml)`).
- `scripts/build-*.mjs` — ETL for static layers (similar data flow but on Node + mapshaper).

## ETL scripts that consume external data (similar rules)

`scripts/build-*.mjs` (RNAP, PRC, DPA, red vial, drenaje, catastro frutícola) all follow the same discipline:

1. **Fetch** the upstream URL (MMA GeoPortal, MOP ArcGIS, etc.).
2. **Stream + parse** to avoid loading the full payload into memory.
3. **Simplify** with `mapshaper` (visvalingam 8% keep-shapes budget by default).
4. **Reproject** to WGS84 (EPSG:4326) if the source isn't already.
5. **Emit** `public/data/<name>.geojson` (compressed) + `public/data/<name>.meta.json` (with feature count and license).
6. **Update docs/arquitectura-capas.md** with the new layer's status.

External data is served from `/public/data/*.geojson` as a static file (Vercel CDN cached). The client NEVER re-fetches the upstream — Node ETL is the only writer.

If a future source requires an API key or auth token, that key is bound to the ETL (Node) at build time, NEVER in client-side environment variables.
