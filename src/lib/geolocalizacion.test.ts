import { describe, expect, it } from 'vitest';
import { formatoPrecision, geoErrorCode, geoErrorMessage, geoSuccessMessage } from '@/lib/geolocalizacion';

describe('geoErrorCode', () => {
  it('maps the GeolocationPositionError codes', () => {
    expect(geoErrorCode(1)).toBe('denied');
    expect(geoErrorCode(2)).toBe('unavailable');
    expect(geoErrorCode(3)).toBe('timeout');
    expect(geoErrorCode(99)).toBe('unavailable');
  });

  it('has a message for every code', () => {
    for (const code of ['unsupported', 'denied', 'unavailable', 'timeout'] as const) {
      expect(geoErrorMessage(code).length).toBeGreaterThan(10);
    }
  });
});

describe('formatoPrecision', () => {
  it('reads metres and kilometres in Chilean format', () => {
    expect(formatoPrecision(7.6)).toBe('±8 m');
    expect(formatoPrecision(0.2)).toBe('±1 m');
    expect(formatoPrecision(3240)).toBe('±3,2 km');
  });

  it('refuses nonsense', () => {
    expect(formatoPrecision(Number.NaN)).toBe('precisión desconocida');
    expect(formatoPrecision(-1)).toBe('precisión desconocida');
  });
});

describe('geoSuccessMessage', () => {
  it('warns when the fix is coarse', () => {
    expect(geoSuccessMessage(12)).toBe('Tu ubicación (±12 m).');
    expect(geoSuccessMessage(2500)).toContain('precisión baja');
  });
});
