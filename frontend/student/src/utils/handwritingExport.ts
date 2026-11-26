import type { HandwritingSnapshot, InkStroke } from '../components/handwriting/HandwritingCanvas';
import {
  ANSWER_IMAGE_MAX_DIMENSION,
  encodeCanvasAsJpeg,
  scaledImageSize,
} from './imageCompression';
import { drawSmoothPath } from './smoothInk';

const DEFAULT_BACKGROUND = '#fffdf8';
const MAX_EXPORT_DPR = 2;
export const HANDWRITING_BACKGROUND_IMAGE_ERROR = '题图加载失败，无法生成完整作答图片，请检查网络后重试';

export async function handwritingSnapshotToFile(
  snapshot: HandwritingSnapshot,
  fileName: string,
  background = DEFAULT_BACKGROUND,
): Promise<File> {
  const width = Math.max(1, Math.round(snapshot.width || 1));
  const height = Math.max(1, Math.round(snapshot.height || 1));
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_EXPORT_DPR);
  const exportSize = scaledImageSize(width * dpr, height * dpr, ANSWER_IMAGE_MAX_DIMENSION);
  const exportScaleX = exportSize.width / width;
  const exportScaleY = exportSize.height / height;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = exportSize.width;
  exportCanvas.height = exportSize.height;
  const exportCtx = exportCanvas.getContext('2d');
  if (!exportCtx) throw new Error('无法生成手写图片');
  exportCtx.setTransform(exportScaleX, 0, 0, exportScaleY, 0, 0);

  exportCtx.fillStyle = background;
  exportCtx.fillRect(0, 0, width, height);
  await drawSnapshotBackground(exportCtx, snapshot);

  const inkCanvas = document.createElement('canvas');
  inkCanvas.width = exportSize.width;
  inkCanvas.height = exportSize.height;
  const inkCtx = inkCanvas.getContext('2d');
  if (!inkCtx) throw new Error('无法生成手写图片');
  inkCtx.setTransform(exportScaleX, 0, 0, exportScaleY, 0, 0);
  for (const stroke of snapshot.strokes || []) {
    drawSnapshotStroke(inkCtx, stroke);
  }
  exportCtx.drawImage(inkCanvas, 0, 0, width, height);

  return encodeCanvasAsJpeg(exportCanvas, fileName);
}

async function drawSnapshotBackground(ctx: CanvasRenderingContext2D, snapshot: HandwritingSnapshot) {
  const backgroundImage = snapshot.backgroundImage;
  if (!backgroundImage?.imagePath) return;
  try {
    const image = await loadImage(backgroundImage.imagePath);
    ctx.drawImage(
      image,
      backgroundImage.x,
      backgroundImage.y,
      backgroundImage.width,
      backgroundImage.height,
    );
  } catch {
    throw new Error(HANDWRITING_BACKGROUND_IMAGE_ERROR);
  }
}

function drawSnapshotStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke) {
  if (!stroke.points?.length) return;
  const previousComposite = ctx.globalCompositeOperation;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.width;
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.fillStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color || '#1f2933';
    ctx.fillStyle = stroke.color || '#1f2933';
  }
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    ctx.beginPath();
    ctx.arc(point.x, point.y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    drawSmoothPath(ctx, stroke.points, { width: stroke.width, tool: stroke.tool });
  }
  ctx.globalCompositeOperation = previousComposite;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(HANDWRITING_BACKGROUND_IMAGE_ERROR));
    image.src = src;
  });
}
