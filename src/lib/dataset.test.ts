import { describe, expect, it } from 'vitest';
import { DATASET_PARAM, datasetToken, withDataset } from './dataset';

describe('datasetToken', () => {
  it('moves when the row count moves', () => {
    const t = '2026-11-05T02:32:51.385Z';
    expect(datasetToken(100, t)).not.toBe(datasetToken(101, t));
  });

  it('moves when only the timestamp moves (same count after a re-load)', () => {
    expect(datasetToken(100, '2026-11-05T02:32:51.385Z'))
      .not.toBe(datasetToken(100, '2026-11-05T03:00:00.000Z'));
  });

  it('is stable while nothing changes', () => {
    expect(datasetToken(100, '2026-11-05T02:32:51.385Z'))
      .toBe(datasetToken(100, '2026-11-05T02:32:51.385Z'));
  });

  it('survives an empty or unparsable timestamp', () => {
    expect(datasetToken(0, null)).toBe('0.0');
    expect(datasetToken(5, 'no es una fecha')).toBe('5.0');
  });
});

describe('withDataset', () => {
  it('adds the token as its own parameter', () => {
    const qs = withDataset('comuna=Panguipulli&anio_min=2012', 'abc');
    expect(new URLSearchParams(qs).get(DATASET_PARAM)).toBe('abc');
    expect(new URLSearchParams(qs).get('comuna')).toBe('Panguipulli');
  });

  it('works on an empty query string', () => {
    expect(withDataset('', 'abc')).toBe('ds=abc');
  });

  it('leaves the query untouched when there is no token', () => {
    expect(withDataset('comuna=Panguipulli', null)).toBe('comuna=Panguipulli');
    expect(withDataset('', null)).toBe('');
  });

  it('never collides with the permalink viewport parameter', () => {
    expect(DATASET_PARAM).not.toBe('v');
  });
});
