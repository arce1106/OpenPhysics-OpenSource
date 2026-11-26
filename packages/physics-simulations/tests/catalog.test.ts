import { describe, expect, it } from 'vitest';
import { simulationCatalog } from '../scenarios/catalog';

describe('simulation catalog', () => {
  it('uses unique stable ids', () => {
    const ids = simulationCatalog.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('publishes only implemented simulations as available', () => {
    expect(simulationCatalog.filter(item => item.status === 'available').map(item => item.id))
      .toEqual(['block-board-horizontal-ground']);
  });
});
