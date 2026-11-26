import { describe, expect, it } from 'vitest';
import { calculateDraftBackgroundRect } from './handwritingBackground';

describe('calculateDraftBackgroundRect', () => {
  it('places question images small at the upper-left of the draft canvas', () => {
    const rect = calculateDraftBackgroundRect({
      sourceWidth: 1000,
      sourceHeight: 600,
      targetWidth: 960,
      targetHeight: 620,
    });

    expect(rect.x).toBe(16);
    expect(rect.y).toBe(16);
    expect(rect.width).toBeLessThanOrEqual(404);
    expect(rect.height).toBeLessThanOrEqual(224);
    expect(rect.scale).toBeLessThan(0.5);
  });
});
