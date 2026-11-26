export type PolarArcSegment = {
  d: string;
  stroke: string;
};

export type PolarArcCap = {
  key: 'start' | 'end';
  x: number;
  y: number;
  fill: string;
};

type BuildPolarArcSegmentsOptions = {
  center: number;
  radius: number;
  ratio: number;
  palette: readonly string[];
  segmentCount?: number;
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

function polarToCartesian(center: number, radius: number, angleDegrees: number) {
  const angleRadians = (angleDegrees - 90) * Math.PI / 180;
  return {
    x: center + (radius * Math.cos(angleRadians)),
    y: center + (radius * Math.sin(angleRadians)),
  };
}

function arcPath(center: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(center, radius, startAngle);
  const end = polarToCartesian(center, radius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return [
    'M', start.x, start.y,
    'A', radius, radius, 0, largeArcFlag, 1, end.x, end.y,
  ].join(' ');
}

function parseHexColor(color: string): Rgb {
  const normalized = color.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toHexColor({ r, g, b }: Rgb) {
  return `#${[r, g, b].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

export function interpolateHexColor(startColor: string, endColor: string, ratio: number) {
  const start = parseHexColor(startColor);
  const end = parseHexColor(endColor);
  const safeRatio = Math.min(1, Math.max(0, ratio));
  return toHexColor({
    r: start.r + ((end.r - start.r) * safeRatio),
    g: start.g + ((end.g - start.g) * safeRatio),
    b: start.b + ((end.b - start.b) * safeRatio),
  });
}

export function colorAtRatio(palette: readonly string[], ratio: number) {
  if (palette.length === 0) return '#14919b';
  if (palette.length === 1) return palette[0];

  const safeRatio = Math.min(1, Math.max(0, ratio));
  const scaled = safeRatio * (palette.length - 1);
  const index = Math.min(palette.length - 2, Math.floor(scaled));
  return interpolateHexColor(palette[index], palette[index + 1], scaled - index);
}

export function buildClockwiseArcSegments({
  center,
  radius,
  ratio,
  palette,
  segmentCount = 28,
}: BuildPolarArcSegmentsOptions): PolarArcSegment[] {
  const visibleRatio = Math.min(1, Math.max(0, ratio));
  if (visibleRatio <= 0) return [];

  const totalSegments = Math.max(1, Math.ceil(visibleRatio * segmentCount));
  const segmentRatio = visibleRatio / totalSegments;
  const overlapRatio = Math.min(0.004, segmentRatio * 0.45);

  return Array.from({ length: totalSegments }, (_, index) => {
    const startRatio = index * segmentRatio;
    const endRatio = (index + 1) * segmentRatio;
    const drawEndRatio = Math.min(1, endRatio + (index < totalSegments - 1 ? overlapRatio : 0));
    return {
      d: arcPath(center, radius, startRatio * 360, drawEndRatio * 360),
      stroke: colorAtRatio(palette, endRatio),
    };
  });
}

export function buildClockwiseArcCaps({
  center,
  radius,
  ratio,
  palette,
}: Omit<BuildPolarArcSegmentsOptions, 'segmentCount'>): PolarArcCap[] {
  const visibleRatio = Math.min(1, Math.max(0, ratio));
  if (visibleRatio <= 0 || visibleRatio >= 1) return [];

  const start = polarToCartesian(center, radius, 0);
  const end = polarToCartesian(center, radius, visibleRatio * 360);

  return [
    {
      key: 'start',
      x: start.x,
      y: start.y,
      fill: colorAtRatio(palette, 0),
    },
    {
      key: 'end',
      x: end.x,
      y: end.y,
      fill: colorAtRatio(palette, visibleRatio),
    },
  ];
}
