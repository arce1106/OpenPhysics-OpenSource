import { describe, expect, it } from 'vitest';
import { buildClockwiseArcCaps, buildClockwiseArcSegments, colorAtRatio } from './polarArcSegments';

describe('polar arc segments', () => {
  it('builds clockwise arc segments from the 12 o clock position', () => {
    const segments = buildClockwiseArcSegments({
      center: 20,
      radius: 10,
      ratio: 0.25,
      palette: ['#0b8d96', '#63eadf'],
      segmentCount: 4,
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].d).toContain('M 20 10');
    expect(segments[0].d).toContain('A 10 10 0 0 1 30 20');
  });

  it('builds separate cap markers for partial arcs', () => {
    const caps = buildClockwiseArcCaps({
      center: 20,
      radius: 10,
      ratio: 0.25,
      palette: ['#0b8d96', '#63eadf'],
    });

    expect(caps).toHaveLength(2);
    expect(caps[0]).toMatchObject({ key: 'start', x: 20, y: 10 });
    expect(caps[1]).toMatchObject({ key: 'end', x: 30, y: 20 });
  });

  it('uses darker start colors and lighter end colors across progress', () => {
    const first = colorAtRatio(['#0b8d96', '#63eadf'], 0);
    const middle = colorAtRatio(['#0b8d96', '#63eadf'], 0.5);
    const last = colorAtRatio(['#0b8d96', '#63eadf'], 1);

    expect(first).toBe('#0b8d96');
    expect(middle).not.toBe(first);
    expect(last).toBe('#63eadf');
  });

  it('returns no visible segment for zero progress', () => {
    expect(buildClockwiseArcSegments({
      center: 20,
      radius: 10,
      ratio: 0,
      palette: ['#0b8d96', '#63eadf'],
    })).toEqual([]);
  });
});
