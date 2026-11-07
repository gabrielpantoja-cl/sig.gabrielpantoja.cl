---
name: leaflet-canvas-sync
description: Procedural rules for interfacing Leaflet 1.9 imperative API with React 19 in this SIG — `useRef`-based map initialization, async layer effects, StrictMode-safe cleanup, visibility toggle without rebuilding markers, and overlayPane canvas extraction. Invoke this skill BEFORE editing src/components/MapView.tsx or any component that creates `L.Map`, `L.GeoJSON`, `L.TileLayer`, `L.MarkerClusterGroup`, or `L.Marker`.
license: MIT
compatibility: claude-code, opencode
metadata:
  category: doctrine
  data-tier: B
---

## When to apply
Any time you edit a file that:
- Instantiates `new L.Map(...)` or extends its behavior.
- Adds a `L.GeoJSON` / `L.TileLayer` / `L.ImageOverlay` / `L.MarkerClusterGroup` via React `useEffect`.
- Touches `map._pathRoot`, `map.getPanes()`, `map._container`, or `map.eachLayer`.
- Implements layer visibility toggles, reorder (`bringToFront` / `bringToBack`).

## Hard rules

### 1. SSR boundary
Leaflet requires `window`. ANY component that imports `leaflet` MUST be loaded via `dynamic(() => import(...), { ssr: false })`. Server-side bundles throw `window is not defined`. See the `dynamic(() => import('@/components/MapView'), …)` in `src/app/page.tsx`.

```tsx
// page.tsx
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => null,  // RetroLoader covers this
});
```

### 2. Single-mount imperative core
The map instance is created exactly once. StrictMode in dev will double-mount; the `if (mapRef.current || !containerRef.current) return;` guard is non-negotiable.

```ts
useEffect(() => {
  if (mapRef.current || !containerRef.current) return;
  const map = L.map(containerRef.current, { preferCanvas: true });
  // ... tiles, controls ...
  mapRef.current = map;
  return () => {
    map.remove();
    mapRef.current = null;  // also clear the ref so the next mount can re-init
  };
}, []);  // ← empty deps, single mount
```

### 3. React → Leaflet data bridge
Add layers in SEPARATE useEffects with dependency arrays. NEVER reconstruct layers on every render. See the cluster-build effect in `src/components/MapView.tsx` (the one that sets `chunkedLoading`).

```ts
useEffect(() => {
  if (!mapRef.current) return;
  const layer = L.geoJSON(data, { ... }).addTo(mapRef.current);
  return () => {
    mapRef.current?.removeLayer(layer);
  };
}, [data]);  // ← react only when the *data identity* changes
```

### 4. MarkerClusterGroup cleanup
`leaflet.markercluster`'s `setTimeout` chunks (used by `chunkedLoading`) survive component `removeLayer()`. In StrictMode dev double-mount this manifests as `Cannot read properties of null (reading 'getMinZoom')`. The fix is a closure-local `_addLayer` nullification in cleanup:

```ts
return () => {
  cancelled = true;
  // neutralize pending chunks: without map, _addLayer dereferences this._map.getMinZoom()
  (group as unknown as { _addLayer: () => void })._addLayer = () => {};
  if (mapRef.current && mapRef.current.hasLayer(group)) {
    mapRef.current.removeLayer(group);
  }
};
```

### 5. Visibility toggle ≠ rebuild
Separating "build the marker cluster" from "show the cluster on the map" lets the perito toggle a 74k-marker layer instantly. The pattern, as used in `MapView.tsx`:

```ts
// Effect A: builds+adds cluster when `points` changes (deferred via cluster's
// own chunkedLoading).
useEffect(() => {
  /* build markers, addLayers, draw */
}, [points, reorderOverlays]);

// Effect B: shows/hides the existing cluster when `showPoints` changes.
// Visibility does NOT depend on `points`, so toggling the layer is O(1).
useEffect(() => {
  const map = mapRef.current;
  const cluster = clusterRef.current;
  if (!map || !cluster) return;
  if (showPoints && !map.hasLayer(cluster)) {
    map.addLayer(cluster);
    reorderOverlays();
  } else if (!showPoints && map.hasLayer(cluster)) {
    map.removeLayer(cluster);
  }
}, [showPoints, reorderOverlays]);
```

Visibility toggles NEVER invalidate `points` itself.

### 6. Renderer pinning for vectors
All vectors (areas protegidas, PRC, DPA, red vial, drenaje, catastro, KML user) need a canvas renderer with `preferCanvas: true` set on the map. With that flag, paths share the map's `_renderer` (a single `L.Canvas` instance created lazily on first path add). No per-layer `renderer` option is needed.

### 7. Z-order convention
`reorderOverlays()` in `src/components/MapView.tsx` is the ONLY source of truth
for stacking — read it, don't copy its order into docs. The shape it keeps:
continuous rasters at the bottom (bioclima → NDVI → relieve), then context
polygons (comunas, protected), thematic polygons, line networks, the heat map,
and the perito's operational layers on top (KML, CBR points stay clickable).
Every layer effect/hook calls `reorderOverlays()` after attaching; a new layer
gets an explicit slot there with a comment saying why.

### 8. overlayPane capture for export
Owned by the **`map-export` skill**: `drawOverlayPaneToCanvas` draws every
`<canvas>` and `<img>` in the overlayPane in DOM order, honouring computed
opacity/visibility. `map._pathRoot` does NOT exist in Leaflet 1.9.x — never
reach for it.

### 9. CSS transforms in tiled panes
Leaflet uses `transform: translate3d(...)` on `tilePane`, `overlayPane`, and per-layer canvases during pan/zooming. **The bounding rect AFTER transforms is the source of truth** — never use `L.DomUtil.getPosition` or `_pathRoot`-based math for the export. Use `getBoundingClientRect()` and subtract the container's rect.

### 10. Per-layer loading gating
Don't `addLayer` until both the data and the parent effect have decided what to load. New layers live in their own hook under `src/components/map/` (`useStaticGeoJsonLayer` for static files, `useViewportRaster` for per-viewport PNGs); follow `docs/arquitectura-capas.md` § recipe. The gating pattern, with `[showX, reorderOverlays]` deps:

```ts
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  if (urbanLimitRef.current) {
    map.removeLayer(urbanLimitRef.current);
    urbanLimitRef.current = null;
  }
  if (!showUrbanLimit) return;
  // fetch + parse + addTo(map)
}, [showUrbanLimit, reorderOverlays]);
```

This pattern lets the perito toggle a layer on/off without re-fetching the GeoJSON on each off-then-on transition.

### 11. StrictMode handling: state-flavoured ref persistence
Don't rely on `useRef` being kept through StrictMode double-mounts in any way other than checking `mapRef.current || !containerRef.current` before re-initializing. The `useRef(...)` instance survives, but the DOM target it pointed to may not — re-assign on every mount.

## Performance budgets & renderer choice

Targets for review (not CI-enforced), on a mid-tier laptop in Chrome:

- CBR pins (~85k, chunked clustering): first paint < 2 s; panning ≥ 30 fps
  with the usual layers on.
- Vector overlay paint: < 1 s for layers under 500 features.
- PNG export: hard ceiling `EXPORT_TIMEOUT_MS` (8 s).

Renderer decision:

- **Canvas** (`preferCanvas: true`, global): every GeoJSON polygon/line and the
  cluster bubbles. SVG only for a handful (<100) of rich-HTML markers.
- **Vector tiling** (`geojson-vt` + a canvas tile renderer) is the next step
  only when one static layer exceeds ~5 MB on the wire or ~10k features after
  the `scripts/build-*.mjs` simplification — not before.
- **OffscreenCanvas / Worker rendering**: only for ≥30 Hz updates; the app
  has none.

## Anti-patterns (NEVER do this)

- Wrapping Leaflet in `react-leaflet` for >100 features. The wrapper triggers a full React reconciliation cycle on every map event.
- `key={Date.now()}` on a layer component to force re-render. Destroys every cache Leaflet has.
- Computing `useState`/`useReducer` for `mapRef.current.layers` — derive from refs.
- Adding `L.featureGroup()` to track cluster members in React state.
- Promise-based `[await map.fire('ready')]` — Leaflet doesn't emit ready; use `map.on('layeradd')` or polling `map.getSize()` non-zero.
- Calling `map.invalidateSize()` on every resize — debounce with `requestAnimationFrame`.
- Reading `process.env.NEON_DATABASE_URL` in client code (it's server-only).
- Forgetting `crossOrigin='anonymous'` on tile `<img>`s that will end up on a `<canvas>` that we'll later `toBlob`.

## Reference files in this repo
- `src/components/MapView.tsx` — the canonical example.
- `src/components/map/` — one hook per thematic layer.
- `map-export` skill — everything about the PNG capture.
- `docs/arquitectura-capas.md` — layer spec, including which layers go in which pane.
- `AGENTS.md` — project-level rules this skill must respect (no `react-leaflet`, no client-side DB, semicolons, etc.).
