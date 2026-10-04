import 'server-only';
import { createHmac } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { userAgent } from 'next/server';
import { clientIp } from '@/lib/security';
import { BUILD_ID } from '@/lib/version';
import {
  isAnalyticsEvent,
  type AnalyticsPayload,
  type AnalyticsProps,
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

/** true si el navegador pidió no ser rastreado (DNT / Global Privacy Control). */
export function optedOut(req: Request): boolean {
  return req.headers.get('dnt') === '1' || req.headers.get('sec-gpc') === '1';
}

export function isBot(req: Request): boolean {
  return userAgent(req).isBot;
}

export async function recordEvent(req: Request, payload: AnalyticsPayload): Promise<void> {
  const url = process.env.ANALYTICS_DATABASE_URL;
  if (!url) return;

  const ua = userAgent(req);
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
      ${ua.device.type || 'desktop'}, ${clip(ua.browser.name, 40)}, ${clip(ua.os.name, 40)},
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
