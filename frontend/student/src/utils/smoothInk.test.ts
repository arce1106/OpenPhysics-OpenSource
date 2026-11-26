import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InkPoint } from './smoothInk';
import { drawSmoothPath, nextInkPoint, strokePointPressures } from './smoothInk';

const getStrokeSpy = vi.hoisted(() => vi.fn());

vi.mock('perfect-freehand', async importOriginal => {
  const actual = await importOriginal<typeof import('perfect-freehand')>();
  return {
    ...actual,
    getStroke: (...args: Parameters<typeof actual.getStroke>) => {
      getStrokeSpy(...args);
      return actual.getStroke(...args);
    },
  };
});

function mockContext() {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('smoothInk', () => {
  beforeEach(() => {
    getStrokeSpy.mockClear();
  });

  it('draws handwriting strokes as filled freehand outlines instead of centerline segments', () => {
    const ctx = mockContext();

    drawSmoothPath(ctx, [
      { x: 0, y: 0 },
      { x: 12, y: 6 },
      { x: 28, y: 18 },
      { x: 42, y: 28 },
    ], { width: 3, tool: 'pen' });

    expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('renders pen handwriting as a filled pressure-sensitive outline', () => {
    const ctx = mockContext();

    drawSmoothPath(ctx, [
      { x: 0, y: 0, pressure: 0.15, toolType: 2 },
      { x: 12, y: 5, pressure: 0.35, toolType: 2 },
      { x: 28, y: 18, pressure: 0.5, toolType: 2 },
      { x: 46, y: 30, pressure: 0.2, toolType: 2 },
    ], { width: 4, tool: 'pen' });

    expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    expect(ctx.closePath).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('curves the freehand outline so fast strokes do not render as polygon edges', () => {
    const ctx = mockContext();

    drawSmoothPath(ctx, [
      { x: 0, y: 0, pressure: 0.25, toolType: 2 },
      { x: 40, y: 4, pressure: 0.28, toolType: 2 },
      { x: 88, y: 24, pressure: 0.3, toolType: 2 },
      { x: 132, y: 18, pressure: 0.24, toolType: 2 },
      { x: 176, y: 42, pressure: 0.22, toolType: 2 },
    ], { width: 4, tool: 'pen' });

    expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    expect(ctx.closePath).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('renders near-stationary Apple Pencil samples as an ink dot', () => {
    const ctx = mockContext();

    drawSmoothPath(ctx, [
      { x: 60, y: 60, t: 1000, pressure: 0.4, toolType: 2 },
      { x: 60.18, y: 60.12, t: 1016, pressure: 0.35, toolType: 2 },
    ], { width: 4, tool: 'pen' });

    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it.each([4, 8])('keeps a near-stationary %i-sample Apple Pencil tap as an ink dot', sampleCount => {
    const ctx = mockContext();
    const jitter = [
      [0, 0],
      [0.42, 0.04],
      [-0.04, 0.34],
      [0.48, -0.06],
      [0.08, 0.46],
      [0.56, 0.28],
      [0.18, -0.12],
      [0.38, 0.4],
    ];
    const points = jitter.slice(0, sampleCount).map(([dx, dy], index) => ({
      x: 60 + dx,
      y: 60 + dy,
      t: 1000 + index * 2,
      pressure: 0.08,
      toolType: 2,
    }));

    drawSmoothPath(ctx, points, { width: 4, tool: 'pen' });

    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.fill).toHaveBeenCalled();
    expect(getStrokeSpy).not.toHaveBeenCalled();
  });

  it('keeps a clearly moving multi-sample mark on the freehand path', () => {
    const ctx = mockContext();
    const points = Array.from({ length: 8 }, (_, index) => ({
      x: 20 + index * 4,
      y: 40 + index * 0.2,
      t: 1000 + index * 4,
      pressure: 0.4,
      toolType: 2,
    }));

    drawSmoothPath(ctx, points, { width: 4, tool: 'pen' });

    expect(ctx.arc).not.toHaveBeenCalled();
    expect(getStrokeSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps slow Apple Pencil handwriting steadier than fast strokes', () => {
    const previous = { x: 0, y: 0, t: 1000, pressure: 0.4, toolType: 2 };
    const slow = nextInkPoint([previous], { x: 1, y: 0, t: 1040, pressure: 0.8, toolType: 2 });
    const fast = nextInkPoint([previous], { x: 18, y: 0, t: 1016, pressure: 0.8, toolType: 2 });

    expect(slow).not.toBeNull();
    expect(fast).not.toBeNull();
    expect(slow!.x).toBeLessThan(1);
    expect(fast!.x).toBeGreaterThan(14);
    expect(slow!.pressure).toBeLessThan(fast!.pressure);
  });

  it('keeps constant sampled pressure stable instead of remapping it repeatedly', () => {
    const points = [] as Array<{ x: number; y: number; t: number; pressure?: number; toolType: number }>;

    for (let index = 0; index < 12; index += 1) {
      const point = nextInkPoint(points, {
        x: index * 4,
        y: index,
        t: 1000 + index * 16,
        pressure: 0.4,
        toolType: 2,
      });
      expect(point).not.toBeNull();
      points.push(point!);
    }

    for (const point of points) {
      expect(point.pressure).toBeCloseTo(0.4, 8);
    }
  });

  it('preserves missing pressure so pen input is not mistaken for hardware pressure', () => {
    const first = nextInkPoint<InkPoint>([], { x: 0, y: 0, t: 1000, toolType: 2 });
    const second = nextInkPoint<InkPoint>([first!], { x: 8, y: 0, t: 1016, toolType: 2 });

    expect(first?.pressure).toBeUndefined();
    expect(second?.pressure).toBeUndefined();

    drawSmoothPath(mockContext(), [
      first!,
      second!,
      { x: 16, y: 1, t: 1032, toolType: 2 },
      { x: 24, y: 2, t: 1048, toolType: 2 },
    ], { width: 4, tool: 'pen' });

    expect(getStrokeSpy).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ simulatePressure: true }),
    );
  });

  it('keeps sampled pressure within the normalized range', () => {
    const low = nextInkPoint([], { x: 0, y: 0, pressure: -0.5, toolType: 2 });
    const high = nextInkPoint([], { x: 0, y: 0, pressure: 1.5, toolType: 2 });

    expect(low?.pressure).toBe(0);
    expect(high?.pressure).toBe(1);
  });

  it('keeps the first Apple Pencil movement close to the raw point', () => {
    const previous = { x: 0, y: 0, t: 1000, pressure: 0.45, toolType: 2 };
    const point = nextInkPoint([previous], { x: 4, y: 0, t: 1040, pressure: 0.5, toolType: 2 });

    expect(point).not.toBeNull();
    expect(point!.x).toBeGreaterThan(3.2);
  });

  it('filters tiny slow jitter while accepting quick Apple Pencil samples', () => {
    const previous = [
      { x: 0, y: 0, t: 1000, pressure: 0.45, toolType: 2 },
      { x: 1, y: 0, t: 1040, pressure: 0.45, toolType: 2 },
    ];

    expect(nextInkPoint(previous, { x: 1.12, y: 0.04, t: 1088, pressure: 0.46, toolType: 2 })).toBeNull();
    expect(nextInkPoint(previous, { x: 1.42, y: 0.04, t: 1044, pressure: 0.46, toolType: 2 })).not.toBeNull();
  });

  it('keeps the first pressure intact while retaining the current end taper', () => {
    const pressures = strokePointPressures([
      { x: 0, y: 0, t: 1000, pressure: 0.6, toolType: 2 },
      { x: 8, y: 0, t: 1040, pressure: 0.6, toolType: 2 },
      { x: 16, y: 0, t: 1080, pressure: 0.6, toolType: 2 },
      { x: 24, y: 0, t: 1120, pressure: 0.6, toolType: 2 },
      { x: 32, y: 0, t: 1160, pressure: 0.6, toolType: 2 },
    ]);

    expect(pressures[0]).toBeCloseTo(pressures[2]);
    expect(pressures[4]).toBeLessThan(pressures[2]);
    expect(pressures[2]).toBeGreaterThan(0.5);
  });

  it('uses a stable round start without changing the current end taper', () => {
    drawSmoothPath(mockContext(), [
      { x: 0, y: 0, t: 1000, pressure: 0.4, toolType: 2 },
      { x: 8, y: 0, t: 1016, pressure: 0.4, toolType: 2 },
      { x: 16, y: 0, t: 1032, pressure: 0.4, toolType: 2 },
      { x: 24, y: 0, t: 1048, pressure: 0.4, toolType: 2 },
    ], { width: 4, tool: 'pen' });

    expect(getStrokeSpy).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({
        start: { cap: true, taper: false },
        end: { cap: true, taper: 6.4 },
      }),
    );
  });
});
