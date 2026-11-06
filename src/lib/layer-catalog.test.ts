import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYER_CATALOG, layerSummary, layerThumbSrc, layerMatches, type CatalogLayerId } from '@/lib/layer-catalog';

const ids: CatalogLayerId[] = LAYER_CATALOG.flatMap((group) => group.layers.map((layer) => layer.id));

describe('layer catalogue', () => {
  it.each(ids)('%s has a thumbnail in public/', (id) => {
    const file = path.join(process.cwd(), 'public', layerThumbSrc(id));
    expect(existsSync(file), `${file} missing: node scripts/build-layer-thumbs.mjs ${id}`).toBe(true);
  });

  it.each(ids)('%s has a one-line summary', (id) => {
    const summary = layerSummary(id);
    expect(summary.length).toBeGreaterThan(0);
    // Más largo se trunca en la fila de 320 px.
    expect(summary.length).toBeLessThanOrEqual(34);
  });

  it('searches the summary too', () => {
    expect(layerMatches('points', 'compraventas')).toBe(true);
  });
});
