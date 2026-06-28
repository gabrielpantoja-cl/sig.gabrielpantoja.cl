# sig.gabrielpantoja.cl — SIG de suelo

Mapa interactivo y **datos abiertos** de transacciones de suelo rural inscritas en
el Conservador de Bienes Raíces (CBR) del centro-sur de Chile. Público, solo
lectura. Pensado como **instrumento de investigación en ecoinformática** (las
transacciones son la capa base sobre la que crecerán NDVI, GBIF, hidrología y
áreas protegidas) y, de paso, como herramienta de consulta para peritos en
tasaciones judiciales y expropiaciones.

> **Por qué existe / contexto de marca:** este es el **mapa de referenciales
> definitivo**. Reemplaza al `/mapa-cbr` del blog y a los frontends previos
> (`referenciales.cl` archivado, `inmogrid.cl` a deprecar). El activo durable no
> es ningún frontend sino la base de datos **Neon `transacciones-suelo`** + el
> pipeline de scrapers. Encuadre "norte" (investigación), no "puente" (comercial).
> Decisión: 2026-06-26.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **Leaflet** + **leaflet.markercluster** (clustering imperativo de ~74k puntos)
- **Neon** (`@neondatabase/serverless`) — única fuente de verdad, rol read-only
- **Deploy:** Vercel · dominio `sig.gabrielpantoja.cl`

## Arquitectura

El navegador no habla con Postgres; todo pasa por route handlers serverless que
consultan Neon con una whitelist de columnas (nunca PII):

```
Browser → /api/{points,stats,export,facets} → Neon (web_readonly, SELECT)
```

| Endpoint | Qué hace |
|---|---|
| `GET /api/points` | Puntos geolocalizados filtrados (slice privacy-safe) |
| `GET /api/stats` | count, avg, mediana, min/max, $/m² sobre el set filtrado |
| `GET /api/export?format=csv\|geojson` | Descarga del set filtrado (CSV con BOM+`;`, o GeoJSON para QGIS) |
| `GET /api/facets` | Comunas + rangos de año/monto para poblar los filtros |

**Filtros compartidos** (`src/lib/filters.ts`, parametrizados $N, anti-inyección):
`comuna`, `anio_min/max`, `monto_min/max`, `sup_min/max`, `predio` (ILIKE),
`rol` (ILIKE).

## Datos & privacidad

Columnas expuestas: `lat, lng, monto, anio, comuna, predio, superficie, rol`.

- **`rol` SÍ se expone**: es el identificador público de propiedad del SII, **no**
  es dato personal (Ley 19.628). Habilita la búsqueda por ROL para peritos.
- **NUNCA se exponen**: `comprador, vendedor, rut, user_id, observaciones`.

## Fuentes de datos y procedencia

| Capa | Fuente | Licencia | Procedencia |
|---|---|---|---|
| Transacciones CBR | Recopilación propia de inscripciones del Conservador de Bienes Raíces, anonimizada (Ley 19.628) | Uso de consulta | Base Neon `verceldb`, rol read-only |
| Áreas protegidas (RNAP) | [Ministerio del Medio Ambiente — Registro Nacional de Áreas Protegidas](https://lineasdebasepublicas.mma.gob.cl/datos_abiertos/dataset/areas-protegidas), portal *Líneas de Base Públicas* | **CC0 1.0** (dominio público) | Ver `public/data/areas-protegidas.meta.json` |

La capa de áreas protegidas (583 áreas, 12 categorías legales) se construye con un
**pipeline ETL reproducible** que descarga el dato oficial CC0, lo simplifica
preservando topología (mapshaper / Visvalingam) y emite un manifiesto de
procedencia. Cada área enlaza a su ficha oficial en SIMBIO (`url_fuente`). La
geometría simplificada es **solo para visualización web**; para análisis usar la
fuente original.

```bash
npm run data:build   # regenera public/data/areas-protegidas.{geojson,meta.json}
```

> Nota científica: las áreas protegidas tienen 12 designaciones legales distintas
> (Parque Nacional, Reserva Nacional, Monumento Natural, Santuario de la
> Naturaleza, etc.), cada una bajo jurisdicción y normativa propia. No deben
> tratarse como una sola categoría.

## Desarrollo

```bash
cp .env.example .env.local   # y completa NEON_DATABASE_URL (rol web_readonly)
npm install
npm run dev                  # http://localhost:3000
npm run build
```

## Variables de entorno

- `NEON_DATABASE_URL` — cadena read-only de Neon (server-side only, sin prefijo
  `NEXT_PUBLIC_`). Configurar en `.env.local` y en Vercel.

## Roadmap (iteraciones futuras)

- Aporte comunitario de referenciales con login (OAuth) + moderación.
- Estadísticas avanzadas (Recharts) + reportes PDF 3 páginas CBR-ready
  (rescatar de `archive/referenciales.cl`).
- Capas ambientales: NDVI/Sentinel-2, biodiversidad (GBIF), hidrología, áreas
  protegidas → consultas PostGIS `ST_DWithin` / `ST_Intersects`.
- Masking PII server-side + API v1 versionada (rescatar de `loxos/inmogrid-cl`).

## Licencia

- **Código**: [MIT](./LICENSE) © 2026 Gabriel Pantoja.
- **Datos de áreas protegidas**: CC0 1.0 (Ministerio del Medio Ambiente de Chile).
- **Mapa base**: © OpenStreetMap contributors.
