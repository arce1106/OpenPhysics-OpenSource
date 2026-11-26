export interface QuestionImageDisplaySource {
  extracted_structure?: Record<string, unknown> | null;
}

const MIN_DISPLAY_WIDTH_PERCENT = 50;
const MAX_DISPLAY_WIDTH_PERCENT = 180;

export function normalizeDisplayWidthPercent(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.min(MAX_DISPLAY_WIDTH_PERCENT, Math.max(MIN_DISPLAY_WIDTH_PERCENT, Math.round(numeric)));
}

export function getDisplayWidthPercent(image?: QuestionImageDisplaySource | null): number {
  return normalizeDisplayWidthPercent(image?.extracted_structure?.display_width_percent);
}

export function getImageScaleStyle(image?: QuestionImageDisplaySource | null): Record<string, string> | undefined {
  const percent = getDisplayWidthPercent(image);
  if (percent === 100) return undefined;
  return { '--question-image-scale': String(percent / 100) };
}

export function buildImageExtractedStructure(
  current: Record<string, unknown> | null | undefined,
  displayWidthPercent: number,
): Record<string, unknown> | null {
  const next = { ...(current || {}) };
  const normalized = normalizeDisplayWidthPercent(displayWidthPercent);
  if (normalized === 100) {
    delete next.display_width_percent;
  } else {
    next.display_width_percent = normalized;
  }
  return Object.keys(next).length > 0 ? next : null;
}
