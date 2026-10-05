import 'server-only';
import { createHmac } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { userAgent } from 'next/server';
import { clientIp } from '@/lib/security';
import { BUILD_ID } from '@/lib/version';
import {
  ANALYTICS_OPT_OUT_COOKIE,
  isAnalyticsEvent,
  type AnalyticsPayload,
  type AnalyticsProps,
  type AnalyticsServerEvent,
} from '@/lib/analytics-events';

/**
 * Lado servidor de la analítica interna. Escribe en `analytics.events` con el
 * rol `analytics_writer` (ANALYTICS_DATABASE_URL), que solo puede insertar,
 * leer y purgar esa tabla — nunca con `web_readonly`, que es solo SELECT, ni
 * con un rol que vea las transacciones CBR. Esquema en `db/analytics.sql`.
 *
 * Sin ANALYTICS_DATABASE_URL la analítica queda apagada (no-op): así un
 * clon del repo o un entorno de desarrollo no falla ni escribe a ningún lado.
 */

const MAX_PROPS = 8;
const MAX_STRING = 80;
const RETENTION_DAYS = 395; // 13 meses: permite comparar un mes con el del año anterior
const PURGE_PROBABILITY = 0.01;

export function analyticsEnabled(): boolean {
  return Boolean(process.env.ANALYTICS_DATABASE_URL);
}

function clip(value: string | null | undefined, max = MAX_STRING): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Valida el cuerpo recibido. Devuelve null si no es un evento aceptable. */
export function parsePayload(raw: unknown): AnalyticsPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  if (!isAnalyticsEvent(body.e)) return null;
  if (typeof body.s !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(body.s)) return null;
  if (typeof body.p !== 'string' || !body.p.startsWith('/')) return null;

  let props: AnalyticsProps | undefined;
  if (body.props && typeof body.props === 'object' && !Array.isArray(body.props)) {
    props = {};
    for (const [key, value] of Object.entries(body.props).slice(0, MAX_PROPS)) {
      if (!/^[a-z_]{1,24}$/.test(key)) continue;
      if (typeof value === 'string') props[key] = value.slice(0, MAX_STRING);
      else if (typeof value === 'number' && Number.isFinite(value)) props[key] = value;
      else if (typeof value === 'boolean') props[key] = value;
    }
  }

  return {
    e: body.e,
    s: body.s,
    p: body.p.split('?')[0].slice(0, 200),
    w: typeof body.w === 'number' && body.w > 0 && body.w < 10000 ? Math.round(body.w) : undefined,
    r: typeof body.r === 'string' ? body.r.slice(0, 120) : undefined,
    props,
  };
}

/**
 * Hash diario del visitante: HMAC-SHA256(secreto + fecha UTC, IP + UA).
 * Cuenta visitantes únicos dentro de un día sin guardar la IP, y como la
 * clave cambia cada día, el mismo navegador no se puede enlazar entre días.
 * Sin ANALYTICS_SALT no se calcula (un hash sin secreto sobre IPv4 se
 * revierte por fuerza bruta, que es justo lo que se quiere evitar).
 */
function visitorId(req: Request): string | null {
  const salt = process.env.ANALYTICS_SALT;
  if (!salt || salt.length < 16) return null;
  const day = new Date().toISOString().slice(0, 10);
  const ua = req.headers.get('user-agent') || '';
  return createHmac('sha256', `${salt}:${day}`)
    .update(`${clientIp(req)}|${ua}`)
    .digest('base64url')
    .slice(0, 22);
}

function geoHeader(req: Request, name: string): string | null {
  const raw = req.headers.get(name);
  if (!raw) return null;
  try {
    return clip(decodeURIComponent(raw), 60);
  } catch {
    return clip(raw, 60);
  }
}

/**
 * true si el navegador pidió no ser rastreado (DNT / Global Privacy Control)
 * o lleva la cookie de exclusión (`?analytics=off`, visitas del administrador).
 */
export function optedOut(req: Request): boolean {
  if (req.headers.get('dnt') === '1' || req.headers.get('sec-gpc') === '1') return true;
  const cookie = req.headers.get('cookie') || '';
  return cookie.split(/;\s*/).some((c) => c === `${ANALYTICS_OPT_OUT_COOKIE}=1`);
}

export function isBot(req: Request): boolean {
  return userAgent(req).isBot;
}

export async function recordEvent(req: Request, payload: AnalyticsPayload): Promise<void> {
  const url = process.env.ANALYTICS_DATABASE_URL;
  if (!url) return;

  const props = { ...(payload.props ?? {}) };
  // Las utm_* llegan como props del pageview y se promueven a columnas.
  const utm = (key: string) => {
    const value = props[key];
    delete props[key];
    return typeof value === 'string' ? clip(value) : null;
  };
  const utmSource = utm('utm_source');
  const utmMedium = utm('utm_medium');
  const utmCampaign = utm('utm_campaign');

  await insertEvent(url, req, payload, props, { utmSource, utmMedium, utmCampaign });
}

/** Primer token del user agent (`curl/8.4.0`, `python-requests/2.31`, `Mozilla/5.0`). */
function clientToken(req: Request): string | null {
  const ua = req.headers.get('user-agent');
  return ua ? clip(ua.split(/\s+/)[0], 40) : null;
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * Registra una consulta a la API de datos (`/api/points`, `/api/export`).
 * Lo llama `src/proxy.ts`, que corre ANTES de la caché de la CDN: así se
 * cuentan también las respuestas cacheadas y las que no vienen del navegador.
 *
 * A diferencia de los eventos de cliente, aquí NO se descartan bots ni
 * clientes sin navegador — precisamente se quiere ver quién descarga datos
 * con scripts. Se registran solo NOMBRES de filtros, nunca sus valores.
 * `source` = `site` si la petición vino del propio mapa, `external` si no.
 */
export async function recordApiEvent(req: Request, event: AnalyticsServerEvent): Promise<void> {
  const url = process.env.ANALYTICS_DATABASE_URL;
  if (!url) return;

  const { pathname, searchParams, host } = new URL(req.url);
  const refererHost = hostOf(req.headers.get('referer'));
  const site =
    req.headers.get('sec-fetch-site') === 'same-origin' || (refererHost !== null && refererHost === host);
  const fields = [...new Set([...searchParams.keys()].filter((k) => k !== 'format'))].sort().join(',');

  const props: AnalyticsProps = {
    source: site ? 'site' : 'external',
    client: clientToken(req) ?? 'none',
    bot: isBot(req),
  };
  if (fields) props.fields = fields.slice(0, MAX_STRING);
  if (event === 'api_export') props.format = (searchParams.get('format') || 'csv').slice(0, 10);

  await insertEvent(
    url,
    req,
    { e: event, s: 'server', p: pathname, r: site ? undefined : (refererHost ?? undefined) },
    props,
    { utmSource: null, utmMedium: null, utmCampaign: null },
  );
}

async function insertEvent(
  url: string,
  req: Request,
  payload: AnalyticsPayload,
  props: AnalyticsProps,
  utm: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null },
): Promise<void> {
  const ua = userAgent(req);
  const { utmSource, utmMedium, utmCampaign } = utm;
  const sql = neon(url);
  await sql`
    INSERT INTO analytics.events (
      env, build, event, visitor_id, session_id, path, referrer_host,
      utm_source, utm_medium, utm_campaign, country, region, city,
      device, browser, os, viewport_w, props
    ) VALUES (
      ${process.env.VERCEL_ENV || 'development'}, ${BUILD_ID}, ${payload.e},
      ${visitorId(req)}, ${payload.s}, ${payload.p}, ${clip(payload.r, 120)},
      ${utmSource}, ${utmMedium}, ${utmCampaign},
      ${geoHeader(req, 'x-vercel-ip-country')},
      ${geoHeader(req, 'x-vercel-ip-country-region')},
      ${geoHeader(req, 'x-vercel-ip-city')},
      ${ua.device.type || (ua.browser.name ? 'desktop' : null)}, ${clip(ua.browser.name, 40)}, ${clip(ua.os.name, 40)},
      ${payload.w ?? null}, ${JSON.stringify(props)}::jsonb
    )
  `;

  // Purga oportunista de retención: sin cron, ~1 de cada 100 inserciones
  // borra lo que pasó los 13 meses. El índice por created_at la hace barata.
  if (Math.random() < PURGE_PROBABILITY) {
    await sql`
      DELETE FROM analytics.events
      WHERE created_at < now() - make_interval(days => ${RETENTION_DAYS})
    `;
  }
}
