import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientIp, corsHeaders, createRateLimiter } from '@/lib/security';

const fromIp = (ip: string) => new Request('https://sig.test/api/points', {
  headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
});

describe('clientIp', () => {
  it('takes the first x-forwarded-for hop', () => {
    expect(clientIp(fromIp('1.2.3.4'))).toBe('1.2.3.4');
    expect(clientIp(new Request('https://sig.test/'))).toBe('unknown');
  });
});

describe('createRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows `max` hits per window and then blocks', () => {
    const limited = createRateLimiter(60_000, 3);
    const req = fromIp('1.1.1.1');
    expect([1, 2, 3].map(() => limited(req))).toEqual([false, false, false]);
    expect(limited(req)).toBe(true);
  });

  it('keeps a separate budget per IP', () => {
    const limited = createRateLimiter(60_000, 1);
    expect(limited(fromIp('1.1.1.1'))).toBe(false);
    expect(limited(fromIp('2.2.2.2'))).toBe(false);
    expect(limited(fromIp('1.1.1.1'))).toBe(true);
  });

  it('frees the budget once the window slides past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limited = createRateLimiter(1_000, 1);
    const req = fromIp('1.1.1.1');
    expect(limited(req)).toBe(false);
    expect(limited(req)).toBe(true);
    vi.setSystemTime(1_001);
    expect(limited(req)).toBe(false);
  });

  it('keeps limiting correctly after sweeping idle IPs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limited = createRateLimiter(1_000, 1);
    for (let i = 0; i < 5_000; i++) limited(fromIp(`10.0.${i >> 8}.${i & 255}`));
    vi.setSystemTime(2_000);
    const req = fromIp('9.9.9.9');
    expect(limited(req)).toBe(false); // triggers the sweep
    expect(limited(req)).toBe(true);
  });
});

describe('corsHeaders', () => {
  it('advertises GET by default and the methods a route passes', () => {
    const req = new Request('https://sig.test/');
    expect(corsHeaders(req)['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    expect(corsHeaders(req, 'GET, POST, OPTIONS')['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
  });
});
