export interface ContainRectInput {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
}

export interface ContainRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export function calculateDraftBackgroundRect({
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
}: ContainRectInput): ContainRect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { x: 16, y: 16, width: 0, height: 0, scale: 1 };
  }

  const maxWidth = targetWidth * 0.42;
  const maxHeight = targetHeight * 0.36;
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 0.42);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: 16,
    y: 16,
    width: round(width),
    height: round(height),
    scale: round(scale),
  };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
