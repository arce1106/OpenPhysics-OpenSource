import { getStroke } from 'perfect-freehand';

export interface InkPoint {
  x: number;
  y: number;
  t?: number;
  pressure?: number;
  toolType?: number;
}

const DEFAULT_STROKE_WIDTH = 2.5;
const DEFAULT_MIN_POINT_DISTANCE = 0.35;
const STATIONARY_DOT_DISTANCE = 0.75;
const INITIAL_MOVEMENT_MIN_SMOOTHING = 0.82;
const MIN_PRESSURE = 0.05;
const DEFAULT_PRESSURE = 0.5;
const PRESSURE_EXPONENT = 0.65;

interface DrawSmoothPathOptions {
  width?: number;
  tool?: 'pen' | 'eraser' | 'pan' | 'image';
  last?: boolean;
}

interface NextInkPointOptions {
  minDistance?: number;
}

export function nextInkPoint<T extends InkPoint>(
  points: InkPoint[],
  rawPoint: T,
  options: NextInkPointOptions = {},
): T | null {
  const point = clampRawPressure(rawPoint);
  const previous = points[points.length - 1];
  if (!previous) return point;

  const distance = distanceBetween(previous, point);
  const speed = speedBetween(previous, point);
  if (points.length >= 2 && distance < adaptiveMinDistance(options.minDistance ?? DEFAULT_MIN_POINT_DISTANCE, speed)) {
    return null;
  }

  const smoothing = adaptiveSmoothing(distance, speed, points.length);
  const pressureBlend = adaptivePressureSmoothing(speed);
  const previousPressure = normalizedRawPressure(previous.pressure);
  const currentPressure = point.pressure;
  const pressure = previousPressure === undefined
    ? currentPressure
    : currentPressure === undefined
      ? previousPressure
      : previousPressure + (currentPressure - previousPressure) * pressureBlend;
  return {
    ...point,
    x: previous.x + (point.x - previous.x) * smoothing,
    y: previous.y + (point.y - previous.y) * smoothing,
    pressure,
  };
}

export function strokePointPressures(points: InkPoint[], tool: DrawSmoothPathOptions['tool'] = 'pen') {
  return points.map((point, index) => {
    if (tool === 'eraser') return DEFAULT_PRESSURE;
    const pressure = remapPressure(normalizedPressure(point.pressure));
    const speed = localSpeed(points, index);
    const speedFactor = (1.08 - speed * 0.16);
    const taper = taperFactor(index, points.length);
    return Math.min(1, Math.max(MIN_PRESSURE, pressure * clamp(speedFactor, 0.74, 1.08) * taper));
  });
}

export function drawSmoothPath(
  ctx: CanvasRenderingContext2D,
  points: InkPoint[],
  options: DrawSmoothPathOptions = {},
) {
  if (points.length === 0) return;
  const width = Math.max(1, options.width || DEFAULT_STROKE_WIDTH);

  if (points.length === 1) {
    drawInkDot(ctx, points[0], width);
    return;
  }

  if (isStationaryDot(points, width)) {
    drawInkDot(ctx, averagePoint(points), width);
    return;
  }

  if (points.length < 4) {
    drawImmediateStroke(ctx, points);
    return;
  }

  const pressures = strokePointPressures(points, options.tool);
  const outline = getStroke(
    points.map((point, index) => [
      point.x,
      point.y,
      pressures[index],
    ]),
    {
      size: width,
      thinning: options.tool === 'eraser' ? 0 : 0.35,
      smoothing: 0.42,
      streamline: 0.22,
      simulatePressure: !points.some(point => point.toolType === 2 && typeof point.pressure === 'number'),
      start: { cap: true, taper: false },
      end: { cap: true, taper: options.tool === 'eraser' ? false : width * 1.6 },
      last: options.last ?? true,
    },
  );

  if (outline.length >= 3) {
    drawCurvedOutline(ctx, outline);
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    const mid = midpoint(points[0], points[1]);
    ctx.quadraticCurveTo(points[0].x, points[0].y, mid.x, mid.y);
    ctx.quadraticCurveTo(points[1].x, points[1].y, points[1].x, points[1].y);
    ctx.stroke();
    return;
  }

  for (let i = 1; i < points.length - 1; i += 1) {
    const mid = midpoint(points[i], points[i + 1]);
    ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  const last = points[points.length - 1];
  ctx.quadraticCurveTo(last.x, last.y, last.x, last.y);
  ctx.stroke();
}

function drawImmediateStroke(ctx: CanvasRenderingContext2D, points: InkPoint[]) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

function drawInkDot(ctx: CanvasRenderingContext2D, point: InkPoint, width: number) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, width / 2, 0, Math.PI * 2);
  ctx.fill();
}

function isStationaryDot(points: InkPoint[], width: number) {
  const maxTravel = Math.max(STATIONARY_DOT_DISTANCE, width * 0.35);
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return Math.hypot(maxX - minX, maxY - minY) <= maxTravel;
}

function averagePoint(points: InkPoint[]): InkPoint {
  const sum = points.reduce<{ x: number; y: number; pressure: number }>((acc, point) => ({
    x: acc.x + point.x,
    y: acc.y + point.y,
    pressure: acc.pressure + (point.pressure ?? DEFAULT_PRESSURE),
  }), { x: 0, y: 0, pressure: 0 });
  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
    pressure: sum.pressure / points.length,
  };
}

function midpoint(a: InkPoint, b: InkPoint) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function clampRawPressure<T extends InkPoint>(point: T): T {
  return {
    ...point,
    pressure: normalizedRawPressure(point.pressure),
  };
}

function normalizedRawPressure(pressure: number | undefined) {
  if (typeof pressure !== 'number' || !Number.isFinite(pressure)) return undefined;
  return clamp(pressure, 0, 1);
}

function normalizedPressure(pressure: number | undefined) {
  return clamp(pressure ?? DEFAULT_PRESSURE, MIN_PRESSURE, 1);
}

export function remapPressure(raw: number, exponent = PRESSURE_EXPONENT) {
  return Math.pow(clamp(raw, 0, 1), exponent);
}

function distanceBetween(a: InkPoint, b: InkPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function speedBetween(a: InkPoint, b: InkPoint) {
  const elapsedMs = Math.max(1, (b.t ?? 0) - (a.t ?? 0));
  return distanceBetween(a, b) / elapsedMs;
}

function localSpeed(points: InkPoint[], index: number) {
  const previous = points[index - 1];
  const current = points[index];
  const next = points[index + 1];
  const speeds: number[] = [];
  if (previous) speeds.push(speedBetween(previous, current));
  if (next) speeds.push(speedBetween(current, next));
  if (speeds.length === 0) return 0;
  return speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
}

function adaptiveMinDistance(minDistance: number, speed: number) {
  const speedFactor = speed < 0.08 ? 1.18 : speed > 0.9 ? 0.68 : 1;
  return clamp(Math.max(DEFAULT_MIN_POINT_DISTANCE, minDistance) * speedFactor, DEFAULT_MIN_POINT_DISTANCE, 2.4);
}

function adaptiveSmoothing(distance: number, speed: number, pointCount: number) {
  const smoothing = clamp(0.48 + distance * 0.018 + speed * 0.22, 0.52, 0.92);
  if (pointCount === 1) {
    return clamp(smoothing, INITIAL_MOVEMENT_MIN_SMOOTHING, 0.96);
  }
  return smoothing;
}

function adaptivePressureSmoothing(speed: number) {
  return speed > 0.9 ? 0.52 : 0.38;
}

function taperFactor(index: number, length: number) {
  const endDistance = length - 1 - index;
  if (endDistance === 0) return 0.82;
  if (length > 4 && endDistance === 1) return 0.88;
  return 1;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function drawCurvedOutline(ctx: CanvasRenderingContext2D, outline: number[][]) {
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);

  for (let index = 1; index < outline.length - 1; index += 1) {
    const current = outline[index];
    const next = outline[index + 1];
    ctx.quadraticCurveTo(
      current[0],
      current[1],
      (current[0] + next[0]) / 2,
      (current[1] + next[1]) / 2,
    );
  }

  const last = outline[outline.length - 1];
  const first = outline[0];
  ctx.quadraticCurveTo(last[0], last[1], first[0], first[1]);
  ctx.closePath();
  ctx.fill();
}
