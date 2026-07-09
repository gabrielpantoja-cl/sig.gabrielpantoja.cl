import { enforce, corsHeaders } from '@/lib/security';
import type { GeocodeResult } from '@/lib/types';

/**
 * GET /api/geocode?q=... — búsqueda de direcciones/lugares (Nominatim/OSM)
 * restringida a Chile, para el autocompletado del buscador del mapa.
 *
 * Proxy fino sobre la API pública de Nominatim: fija el User-Agent que exige
 * su política de uso, limita los resultados y expone SOLO los campos que el
 * mapa necesita (label, lat, lng, bbox). Un caché en memoria por instancia +
 * s-maxage en la CDN mantienen el tráfico hacia Nominatim muy por debajo de
 * su límite (1 req/s).
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'sig.gabrielpantoja.cl (gabrielpantojarivera@gmail.com)';
const MAX_RESULTS = 6;

const cache = new Map<string, { at: number; results: GeocodeResult[] }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hora
const CACHE_MAX = 500;

interface NominatimItem {
  display_name?: string;
  lat?: string;
  lon?: string;
  addresstype?: string;
  type?: string;
  boundingbox?: string[];
}

function toResult(item: NominatimItem): GeocodeResult | null {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!item.display_name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Nominatim entrega boundingbox como [sur, norte, oeste, este] en strings.
  let bbox: GeocodeResult['bbox'] = null;
  if (Array.isArray(item.boundingbox) && item.boundingbox.length === 4) {
    const nums = item.boundingbox.map(Number);
    if (nums.every(Number.isFinite)) bbox = nums as [number, number, number, number];
  }

  return {
    label: item.display_name,
    lat,
    lng,
    type: item.addresstype ?? item.type ?? null,
    bbox,
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;
  const headers = {
    ...corsHeaders(req),
    'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
  };

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim().slice(0, 120);
  if (q.length < 3) return Response.json([], { headers });

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return Response.json(hit.results, { headers });
  }

  try {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('countrycodes', 'cl');
    url.searchParams.set('limit', String(MAX_RESULTS));

    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'es-CL,es;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);

    const raw = (await res.json()) as NominatimItem[];
    const results = raw.map(toResult).filter((r): r is GeocodeResult => r !== null);

    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), results });

    return Response.json(results, { headers });
  } catch (error) {
    console.error('Error geocoding:', error);
    return Response.json(
      { error: 'Failed to geocode' },
      { status: 502, headers: corsHeaders(req) },
    );
  }
}
