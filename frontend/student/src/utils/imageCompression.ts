export const ANSWER_IMAGE_MAX_DIMENSION = 1800;
export const ANSWER_IMAGE_JPEG_QUALITY = 0.86;
export const ANSWER_IMAGE_TARGET_BYTES = 1200 * 1024;
export const ANSWER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ANSWER_IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export const PAPER_IMAGE_MAX_DIMENSION = 2400;
export const PAPER_IMAGE_TARGET_BYTES = 2 * 1024 * 1024;
export const PAPER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PAPER_BATCH_MAX_TOTAL_BYTES = 10 * 1024 * 1024;

const MIN_JPEG_QUALITY = 0.68;
const JPEG_QUALITY_STEP = 0.06;
const MAX_RESIZE_PASSES = 2;

export type ImageCompressionProfile = {
  maxDimension: number;
  targetBytes: number;
  initialQuality?: number;
};

export const ANSWER_IMAGE_PROFILE: ImageCompressionProfile = {
  maxDimension: ANSWER_IMAGE_MAX_DIMENSION,
  targetBytes: ANSWER_IMAGE_TARGET_BYTES,
  initialQuality: ANSWER_IMAGE_JPEG_QUALITY,
};

export const PAPER_IMAGE_PROFILE: ImageCompressionProfile = {
  maxDimension: PAPER_IMAGE_MAX_DIMENSION,
  targetBytes: PAPER_IMAGE_TARGET_BYTES,
  initialQuality: ANSWER_IMAGE_JPEG_QUALITY,
};

export function scaledImageSize(width: number, height: number, maxDimension = ANSWER_IMAGE_MAX_DIMENSION) {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  if (width <= maxDimension && height <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressAnswerImageFile(
  file: File,
  profile: ImageCompressionProfile = ANSWER_IMAGE_PROFILE,
): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(imageUrl);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    const target = scaledImageSize(naturalWidth, naturalHeight, profile.maxDimension);
    const dimensionsUnchanged = target.width === naturalWidth && target.height === naturalHeight;
    if (dimensionsUnchanged && file.type === 'image/jpeg' && file.size <= profile.targetBytes) {
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(image, 0, 0, target.width, target.height);

    const compressed = await encodeCanvasAsJpeg(canvas, file.name, profile);
    if (dimensionsUnchanged && file.type === 'image/jpeg' && compressed.size >= file.size) return file;
    return compressed;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export function compressPaperImageFile(file: File): Promise<File> {
  return compressAnswerImageFile(file, PAPER_IMAGE_PROFILE);
}

export async function encodeCanvasAsJpeg(
  sourceCanvas: HTMLCanvasElement,
  fileName: string,
  profile: ImageCompressionProfile = ANSWER_IMAGE_PROFILE,
): Promise<File> {
  const initialSize = scaledImageSize(sourceCanvas.width, sourceCanvas.height, profile.maxDimension);
  let workingCanvas = initialSize.width === sourceCanvas.width && initialSize.height === sourceCanvas.height
    ? sourceCanvas
    : resizeCanvas(sourceCanvas, initialSize.width, initialSize.height);
  let smallestBlob: Blob | null = null;

  for (let resizePass = 0; resizePass <= MAX_RESIZE_PASSES; resizePass += 1) {
    const initialQuality = profile.initialQuality ?? ANSWER_IMAGE_JPEG_QUALITY;
    for (let quality = initialQuality; quality >= MIN_JPEG_QUALITY - 0.001; quality -= JPEG_QUALITY_STEP) {
      const blob = await canvasToBlob(workingCanvas, Math.max(MIN_JPEG_QUALITY, quality));
      if (!blob) break;
      if (!smallestBlob || blob.size < smallestBlob.size) smallestBlob = blob;
      if (blob.size <= profile.targetBytes) return jpegFile(blob, fileName);
    }

    if (!smallestBlob || resizePass === MAX_RESIZE_PASSES) break;
    const reduction = Math.max(0.65, Math.min(0.9, Math.sqrt(profile.targetBytes / smallestBlob.size) * 0.95));
    const nextWidth = Math.max(1, Math.round(workingCanvas.width * reduction));
    const nextHeight = Math.max(1, Math.round(workingCanvas.height * reduction));
    if (nextWidth === workingCanvas.width && nextHeight === workingCanvas.height) break;
    workingCanvas = resizeCanvas(workingCanvas, nextWidth, nextHeight);
  }

  if (!smallestBlob) throw new Error('图片压缩失败');
  return jpegFile(smallestBlob, fileName);
}

function resizeCanvas(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('图片压缩失败');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function jpegFile(blob: Blob, fileName: string): File {
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'answer';
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
