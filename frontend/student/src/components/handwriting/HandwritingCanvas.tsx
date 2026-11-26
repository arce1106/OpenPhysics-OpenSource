import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { calculateDraftBackgroundRect, type ContainRect } from '../../utils/handwritingBackground';
import { drawSmoothPath, nextInkPoint } from '../../utils/smoothInk';

export interface InkPoint {
  x: number;
  y: number;
  t: number;
  pressure?: number;
  toolType?: number;
}

export interface InkStroke {
  tool: DrawingTool;
  color: string;
  width: number;
  points: InkPoint[];
}

export interface HandwritingCanvasBackgroundImage {
  src: string;
  description?: string | null;
  fit?: 'contain';
}

export interface HandwritingCanvasBackgroundSnapshot {
  imagePath: string;
  description?: string | null;
  fit: 'contain';
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  naturalWidth: number;
  naturalHeight: number;
}

export interface HandwritingSnapshot {
  version: 1;
  width: number;
  height: number;
  viewport?: {
    offsetX: number;
    offsetY: number;
    scale: number;
  };
  backgroundImage?: HandwritingCanvasBackgroundSnapshot | null;
  strokes: InkStroke[];
}

export interface HandwritingCanvasHandle {
  getSnapshot: () => HandwritingSnapshot;
  clear: () => void;
  hasStrokes: () => boolean;
}

type DrawingTool = 'pen' | 'eraser' | 'pan' | 'image';
type SizePanel = DrawingTool | null;
type PenSize = 'thin' | 'medium' | 'thick';
type EraserSize = 'small' | 'medium' | 'large';
type ViewportTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

interface Props {
  ariaLabel: string;
  disabled?: boolean;
  submitting?: boolean;
  height?: number;
  background?: string | null;
  eraserMode?: 'background' | 'clear';
  canvasStyle?: CSSProperties;
  toolbarStyle?: CSSProperties;
  toolbarPlacement?: 'top' | 'floating-right';
  extraToolbarActions?: ReactNode;
  backgroundImage?: HandwritingCanvasBackgroundImage | null;
  initialSnapshot?: HandwritingSnapshot | null;
  showStrokeCount?: boolean;
  enablePanTool?: boolean;
  workspaceScale?: number;
  showPenPositionIndicator?: boolean;
  onStrokeCountChange?: (count: number) => void;
  onSnapshotChange?: () => void;
}

const ACCENT = '#14919b';
const INK_COLOR = '#1f2933';
const DEFAULT_BG = '#fffdf8';
const DEFAULT_HEIGHT = 360;
const MAX_CANVAS_DPR = 2;
const MIN_VIEWPORT_SCALE = 0.72;
const MAX_VIEWPORT_SCALE = 2.4;
const MIN_BACKGROUND_IMAGE_SCALE = 0.08;
const MAX_BACKGROUND_IMAGE_SCALE = 1.8;
const TOOLBAR_LONG_PRESS_MS = 420;
const TOOLBAR_LONG_PRESS_MOVE_TOLERANCE = 8;
const FINGER_WRITING_PREFERENCE_KEY = 'openphysics.handwriting.finger-writing';
const PEN_WIDTHS: Record<PenSize, number> = {
  thin: 2.5,
  medium: 4,
  thick: 6,
};
const PEN_COLORS = [
  { label: '黑色画笔', value: '#1f2933' },
  { label: '红色画笔', value: '#d93025' },
  { label: '蓝色画笔', value: '#1677ff' },
] as const;
const ERASER_WIDTHS: Record<EraserSize, number> = {
  small: 16,
  medium: 28,
  large: 42,
};

function initialFingerWritingPreference() {
  try {
    return window.localStorage.getItem(FINGER_WRITING_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistFingerWritingPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(FINGER_WRITING_PREFERENCE_KEY, String(enabled));
  } catch {
    // The current canvas still keeps the selected mode when storage is unavailable.
  }
}

function getCanvasDpr() {
  return Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
}

function setupCanvasScale(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = getCanvasDpr();
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function clearCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  background: string | null,
  backgroundImage: HTMLImageElement | null = null,
  backgroundRect: ContainRect | null = null,
) {
  const dpr = getCanvasDpr();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  }
  if (backgroundImage && backgroundRect) {
    ctx.drawImage(
      backgroundImage,
      backgroundRect.x,
      backgroundRect.y,
      backgroundRect.width,
      backgroundRect.height,
    );
  }
}

function clearInkCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(getCanvasDpr(), 0, 0, getCanvasDpr(), 0, 0);
}

function pointFromEvent(
  clientX: number,
  clientY: number,
  pressure: number,
  target: HTMLElement,
  viewport: ViewportTransform,
  canvasSize: { width: number; height: number },
  toolType = 0,
  timeMs = Date.now(),
): InkPoint {
  const rect = target.getBoundingClientRect();
  const worldX = (clientX - rect.left - viewport.offsetX) / viewport.scale;
  const worldY = (clientY - rect.top - viewport.offsetY) / viewport.scale;
  return {
    x: Math.min(Math.max(worldX, 0), canvasSize.width),
    y: Math.min(Math.max(worldY, 0), canvasSize.height),
    t: timeMs,
    pressure: pressure || undefined,
    toolType,
  };
}

function worldPointFromClient(
  clientX: number,
  clientY: number,
  target: HTMLElement,
  viewport: ViewportTransform,
) {
  const rect = target.getBoundingClientRect();
  return {
    x: (clientX - rect.left - viewport.offsetX) / viewport.scale,
    y: (clientY - rect.top - viewport.offsetY) / viewport.scale,
  };
}

function pointerToolType(event: PointerEvent | React.PointerEvent, tool: DrawingTool) {
  if (tool === 'eraser') return 5;
  if (tool === 'pan') return 6;
  if (event.pointerType === 'pen') return 2;
  if (event.pointerType === 'touch') return 1;
  return 0;
}

function handwritingStrokesKey(strokes: InkStroke[]) {
  const pointCount = strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
  const lastStroke = strokes[strokes.length - 1];
  const lastPoint = lastStroke?.points[lastStroke.points.length - 1];
  return [
    strokes.length,
    pointCount,
    lastStroke?.tool || '',
    lastStroke?.width || 0,
    lastPoint ? `${lastPoint.x}:${lastPoint.y}:${lastPoint.t}` : '',
  ].join('|');
}

function handwritingSnapshotKey(snapshot: HandwritingSnapshot) {
  const strokes = snapshot.strokes || [];
  const viewport = snapshot.viewport || { offsetX: 0, offsetY: 0, scale: 1 };
  const backgroundImage = snapshot.backgroundImage;
  return [
    handwritingStrokesKey(strokes),
    `${viewport.offsetX}:${viewport.offsetY}:${viewport.scale}`,
    backgroundImage ? `${backgroundImage.imagePath}:${backgroundImage.x}:${backgroundImage.y}:${backgroundImage.width}:${backgroundImage.height}` : '',
  ].join('|');
}

function containRectKey(rect: ContainRect | null) {
  if (!rect) return '';
  return `${rect.x}:${rect.y}:${rect.width}:${rect.height}:${rect.scale}`;
}

function rectFromBackgroundSnapshot(snapshot: HandwritingCanvasBackgroundSnapshot): ContainRect {
  return {
    x: snapshot.x,
    y: snapshot.y,
    width: snapshot.width,
    height: snapshot.height,
    scale: snapshot.scale,
  };
}

function clampBackgroundRect(
  rect: ContainRect,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): ContainRect {
  if (sourceWidth <= 0 || sourceHeight <= 0) return rect;
  const scale = Math.min(Math.max(rect.scale || 1, MIN_BACKGROUND_IMAGE_SCALE), MAX_BACKGROUND_IMAGE_SCALE);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const margin = 24;
  const minX = Math.min(margin, canvasWidth - width - margin);
  const minY = Math.min(margin, canvasHeight - height - margin);
  const maxX = Math.max(canvasWidth - margin, margin);
  const maxY = Math.max(canvasHeight - margin, margin);
  return {
    x: Math.round(Math.max(minX, Math.min(maxX, rect.x)) * 1000) / 1000,
    y: Math.round(Math.max(minY, Math.min(maxY, rect.y)) * 1000) / 1000,
    width: Math.round(width * 1000) / 1000,
    height: Math.round(height * 1000) / 1000,
    scale: Math.round(scale * 1000) / 1000,
  };
}

const HandwritingCanvas = forwardRef<HandwritingCanvasHandle, Props>(function HandwritingCanvas(
  {
    ariaLabel,
    disabled,
    submitting,
    height = DEFAULT_HEIGHT,
    background = DEFAULT_BG,
    eraserMode = 'background',
    canvasStyle,
    toolbarStyle,
    toolbarPlacement = 'top',
    extraToolbarActions,
    backgroundImage,
    initialSnapshot,
    showStrokeCount = false,
    enablePanTool = false,
    workspaceScale = 1,
    showPenPositionIndicator = false,
    onStrokeCountChange,
    onSnapshotChange,
  },
  ref,
) {
  const initialStrokes = initialSnapshot?.strokes || [];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const committedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const activeStrokeRef = useRef<InkStroke | null>(null);
  const strokesRef = useRef<InkStroke[]>(initialStrokes);
  const canvasSizeRef = useRef({ width: 0, height });
  const rafRef = useRef<number>(0);
  const dirtyRef = useRef(false);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const backgroundRectRef = useRef<ContainRect | null>(null);
  const persistSnapshotRef = useRef<(() => void) | null>(null);
  const initialSnapshotRef = useRef(initialSnapshot);
  const appliedSnapshotRef = useRef<HandwritingSnapshot | null>(null);
  const appliedSnapshotKeyRef = useRef<string | null>(null);
  const pendingRestoredStrokesReportRef = useRef<{
    restoredKey: string;
    skipInitialEmpty: boolean;
  } | null>(initialSnapshot ? {
    restoredKey: handwritingStrokesKey(initialStrokes),
    skipInitialEmpty: false,
  } : null);
  const visibleSizeRef = useRef({ width: 0, height });
  const viewportRef = useRef<ViewportTransform>({ offsetX: 0, offsetY: 0, scale: 1 });
  const activePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map());
  const stylusInputActiveRef = useRef(false);
  const navigationTouchPointerIdsRef = useRef<Set<number>>(new Set());
  const ignoredPointerIdsRef = useRef<Set<number>>(new Set());
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: ViewportTransform;
  } | null>(null);
  const imageDragRef = useRef<{
    pointerId: number;
    startWorldX: number;
    startWorldY: number;
    origin: ContainRect;
  } | null>(null);
  const pinchRef = useRef<{
    startDistance: number;
    worldFocus: { x: number; y: number };
    origin: ViewportTransform;
  } | null>(null);
  const imagePinchRef = useRef<{
    startDistance: number;
    worldFocus: { x: number; y: number };
    origin: ContainRect;
  } | null>(null);
  const toolbarDragRef = useRef<{
    pointerId: number;
    startY: number;
    originY: number;
  } | null>(null);
  const toolbarLongPressTimerRef = useRef<number | null>(null);
  const toolbarLongPressCandidateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originY: number;
  } | null>(null);
  const suppressToolbarClickRef = useRef(false);
  const pointerPreviewRef = useRef<InkPoint | null>(null);
  const pointerIndicatorRef = useRef<HTMLDivElement | null>(null);

  const [strokes, setStrokes] = useState<InkStroke[]>(() => initialStrokes);
  const [clearUndoSnapshot, setClearUndoSnapshot] = useState<InkStroke[] | null>(null);
  const [tool, setTool] = useState<DrawingTool>('pen');
  const [sizePanel, setSizePanel] = useState<SizePanel>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [toolbarDragging, setToolbarDragging] = useState(false);
  const [penSize, setPenSize] = useState<PenSize>('medium');
  const [penColor, setPenColor] = useState<(typeof PEN_COLORS)[number]['value']>(INK_COLOR);
  const [eraserSize, setEraserSize] = useState<EraserSize>('small');
  const [penPositionIndicatorEnabled, setPenPositionIndicatorEnabled] = useState(showPenPositionIndicator);
  const [fingerWritingEnabled, setFingerWritingEnabled] = useState(initialFingerWritingPreference);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [viewport, setViewportState] = useState<ViewportTransform>({ offsetX: 0, offsetY: 0, scale: 1 });
  const [toolbarOffsetY, setToolbarOffsetY] = useState(0);
  const activeWidth = tool === 'eraser' ? ERASER_WIDTHS[eraserSize] : PEN_WIDTHS[penSize];
  const effectiveWorkspaceScale = Math.max(1, Math.min(workspaceScale, 1.6));
  const canUndo = strokes.length > 0 || !!clearUndoSnapshot;

  const updatePointerPreview = useCallback((point: InkPoint | null) => {
    pointerPreviewRef.current = point;
    const indicator = pointerIndicatorRef.current;
    if (!indicator) return;
    if (!point) {
      indicator.style.display = 'none';
      return;
    }
    const currentViewport = viewportRef.current;
    indicator.style.left = `${point.x * currentViewport.scale + currentViewport.offsetX}px`;
    indicator.style.top = `${point.y * currentViewport.scale + currentViewport.offsetY}px`;
    indicator.style.display = 'block';
  }, []);

  useEffect(() => {
    persistSnapshotRef.current = onSnapshotChange || null;
  }, [onSnapshotChange]);

  const clampToolbarOffsetY = useCallback((value: number) => {
    const visibleHeight = visibleSizeRef.current.height || height;
    return Math.max(0, Math.min(value, Math.max(0, visibleHeight - 178)));
  }, [height]);

  useEffect(() => {
    setToolbarOffsetY(prev => clampToolbarOffsetY(prev));
  }, [clampToolbarOffsetY, height]);

  useEffect(() => () => {
    if (toolbarLongPressTimerRef.current !== null) {
      window.clearTimeout(toolbarLongPressTimerRef.current);
      toolbarLongPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    initialSnapshotRef.current = initialSnapshot;
  }, [initialSnapshot]);

  useEffect(() => {
    setPenPositionIndicatorEnabled(showPenPositionIndicator);
  }, [showPenPositionIndicator]);

  useEffect(() => {
    if (!penPositionIndicatorEnabled && tool === 'pen') {
      updatePointerPreview(null);
    }
  }, [penPositionIndicatorEnabled, tool, updatePointerPreview]);

  useEffect(() => {
    updatePointerPreview(pointerPreviewRef.current);
  }, [updatePointerPreview, viewport]);

  useEffect(() => {
    if (!backgroundImage?.src && tool === 'image') {
      setTool('pen');
      setSizePanel(null);
    }
  }, [backgroundImage?.src, tool]);

  const setViewport = useCallback((next: ViewportTransform | ((prev: ViewportTransform) => ViewportTransform)) => {
    setViewportState(prev => {
      const value = typeof next === 'function' ? next(prev) : next;
      const clamped = clampViewport(
        value,
        visibleSizeRef.current.width,
        visibleSizeRef.current.height,
        canvasSizeRef.current.width,
        canvasSizeRef.current.height,
      );
      viewportRef.current = clamped;
      return clamped;
    });
  }, []);

  const drawBackgroundLayer = useCallback(() => {
    const canvas = backgroundCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    clearCanvas(
      canvas,
      ctx,
      canvasSizeRef.current.width,
      canvasSizeRef.current.height,
      background,
      backgroundImageRef.current,
      backgroundRectRef.current,
    );
  }, [background]);

  const getCurrentSnapshot = useCallback((): HandwritingSnapshot => ({
    version: 1,
    width: canvasSizeRef.current.width,
    height: canvasSizeRef.current.height,
    viewport: {
      offsetX: viewportRef.current.offsetX,
      offsetY: viewportRef.current.offsetY,
      scale: viewportRef.current.scale,
    },
    backgroundImage: backgroundImage?.src && backgroundImageRef.current && backgroundRectRef.current
      ? {
        imagePath: backgroundImage.src,
        description: backgroundImage.description || null,
        fit: backgroundImage.fit || 'contain',
        x: backgroundRectRef.current.x,
        y: backgroundRectRef.current.y,
        width: backgroundRectRef.current.width,
        height: backgroundRectRef.current.height,
        scale: backgroundRectRef.current.scale,
        naturalWidth: backgroundImageRef.current.naturalWidth,
        naturalHeight: backgroundImageRef.current.naturalHeight,
      }
      : null,
    strokes: strokesRef.current,
  }), [backgroundImage?.description, backgroundImage?.fit, backgroundImage?.src]);

  const markCurrentSnapshotApplied = useCallback(() => {
    const snapshot = getCurrentSnapshot();
    appliedSnapshotRef.current = snapshot;
    appliedSnapshotKeyRef.current = handwritingSnapshotKey(snapshot);
  }, [getCurrentSnapshot]);

  const notifySnapshotChanged = useCallback(() => {
    markCurrentSnapshotApplied();
    persistSnapshotRef.current?.();
  }, [markCurrentSnapshotApplied]);

  const setBackgroundRect = useCallback((next: ContainRect, notify = false) => {
    const image = backgroundImageRef.current;
    if (!image) return;
    const clamped = clampBackgroundRect(
      next,
      image.naturalWidth,
      image.naturalHeight,
      canvasSizeRef.current.width,
      canvasSizeRef.current.height,
    );
    if (containRectKey(backgroundRectRef.current) === containRectKey(clamped)) return;
    backgroundRectRef.current = clamped;
    drawBackgroundLayer();
    if (notify) notifySnapshotChanged();
  }, [drawBackgroundLayer, notifySnapshotChanged]);

  const applyStrokeStyle = useCallback((ctx: CanvasRenderingContext2D, stroke: InkStroke) => {
    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
    }
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: InkStroke) => {
    if (stroke.points.length === 0) return;
    const previousComposite = ctx.globalCompositeOperation;
    applyStrokeStyle(ctx, stroke);
    drawSmoothPath(ctx, stroke.points, { width: stroke.width, tool: stroke.tool });
    ctx.globalCompositeOperation = previousComposite;
  }, [applyStrokeStyle]);

  const rebuildCommittedCache = useCallback((strokesToCache: InkStroke[]) => {
    const cache = committedCanvasRef.current;
    if (!cache) return;
    const width = canvasSizeRef.current.width;
    const height = canvasSizeRef.current.height;
    const dpr = getCanvasDpr();
    cache.width = Math.round(width * dpr);
    cache.height = Math.round(height * dpr);
    const ctx = cache.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const stroke of strokesToCache) {
      drawStroke(ctx, stroke);
    }
  }, [drawStroke]);

  const redrawAll = useCallback((_completedStrokes: InkStroke[], activeStroke?: InkStroke | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawBackgroundLayer();
    clearInkCanvas(canvas, ctx);
    const cache = committedCanvasRef.current;
    if (cache && cache.width > 0 && cache.height > 0) {
      ctx.drawImage(cache, 0, 0, canvasSizeRef.current.width, canvasSizeRef.current.height);
    }
    if (activeStroke) {
      drawStroke(ctx, activeStroke);
    }
  }, [drawBackgroundLayer, drawStroke]);

  const incrementalDraw = useCallback(() => {
    const active = activeStrokeRef.current;
    if (!active) {
      dirtyRef.current = false;
      return;
    }
    if (active && active.points.length >= 2) {
      redrawAll(strokesRef.current, active);
    } else if (active && active.points.length === 1) {
      redrawAll(strokesRef.current, active);
    } else {
      redrawAll(strokesRef.current, null);
    }
    dirtyRef.current = false;
  }, [redrawAll]);

  const scheduleRedraw = useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    rafRef.current = requestAnimationFrame(incrementalDraw);
  }, [incrementalDraw]);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const backgroundCanvas = backgroundCanvasRef.current;
    const box = boxRef.current;
    if (!canvas || !backgroundCanvas || !box) return;
    const visibleWidth = Math.max(280, box.clientWidth);
    const width = Math.round(visibleWidth * effectiveWorkspaceScale);
    const canvasHeight = Math.round(height * effectiveWorkspaceScale);
    visibleSizeRef.current = { width: visibleWidth, height };
    canvasSizeRef.current = { width, height: canvasHeight };
    setupCanvasScale(canvas, width, canvasHeight);
    setupCanvasScale(backgroundCanvas, width, canvasHeight);
    if (!committedCanvasRef.current) {
      committedCanvasRef.current = document.createElement('canvas');
    }
    committedCanvasRef.current.width = Math.round(width * getCanvasDpr());
    committedCanvasRef.current.height = Math.round(canvasHeight * getCanvasDpr());
    const committedCtx = committedCanvasRef.current.getContext('2d');
    if (committedCtx) {
      committedCtx.setTransform(getCanvasDpr(), 0, 0, getCanvasDpr(), 0, 0);
    }
    rebuildCommittedCache(strokesRef.current);
    if (backgroundImageRef.current) {
      backgroundRectRef.current = backgroundRectRef.current
        ? clampBackgroundRect(
          backgroundRectRef.current,
          backgroundImageRef.current.naturalWidth,
          backgroundImageRef.current.naturalHeight,
          width,
          canvasHeight,
        )
        : calculateDraftBackgroundRect({
          sourceWidth: backgroundImageRef.current.naturalWidth,
          sourceHeight: backgroundImageRef.current.naturalHeight,
          targetWidth: width,
          targetHeight: canvasHeight,
        });
    }
    setViewport(prev => clampViewport(prev, visibleWidth, height, width, canvasHeight));
    drawBackgroundLayer();
    redrawAll(strokesRef.current, activeStrokeRef.current);
  }, [drawBackgroundLayer, effectiveWorkspaceScale, height, rebuildCommittedCache, redrawAll, setViewport]);

  useLayoutEffect(() => {
    initCanvas();
    window.addEventListener('resize', initCanvas);
    return () => {
      window.removeEventListener('resize', initCanvas);
      cancelAnimationFrame(rafRef.current);
    };
  }, [initCanvas]);

  useLayoutEffect(() => {
    if (!initialSnapshot) return;
    const snapshotKey = handwritingSnapshotKey(initialSnapshot);
    if (appliedSnapshotRef.current === initialSnapshot || appliedSnapshotKeyRef.current === snapshotKey) return;
    const restoredStrokes = initialSnapshot.strokes || [];
    if (
      backgroundImageRef.current
      && backgroundImage?.src
      && initialSnapshot.backgroundImage?.imagePath === backgroundImage.src
    ) {
      backgroundRectRef.current = clampBackgroundRect(
        rectFromBackgroundSnapshot(initialSnapshot.backgroundImage),
        backgroundImageRef.current.naturalWidth,
        backgroundImageRef.current.naturalHeight,
        canvasSizeRef.current.width,
        canvasSizeRef.current.height,
      );
    }
    pendingRestoredStrokesReportRef.current = {
      restoredKey: handwritingStrokesKey(restoredStrokes),
      skipInitialEmpty: true,
    };
    activeStrokeRef.current = null;
    strokesRef.current = restoredStrokes;
    const restoredViewport = clampViewport(
      initialSnapshot.viewport || { offsetX: 0, offsetY: 0, scale: 1 },
      visibleSizeRef.current.width,
      visibleSizeRef.current.height,
      canvasSizeRef.current.width,
      canvasSizeRef.current.height,
    );
    viewportRef.current = restoredViewport;
    setViewportState(restoredViewport);
    setStrokes(restoredStrokes);
    rebuildCommittedCache(restoredStrokes);
    redrawAll(restoredStrokes, null);
    appliedSnapshotRef.current = initialSnapshot;
    appliedSnapshotKeyRef.current = snapshotKey;
  }, [backgroundImage?.src, initialSnapshot, rebuildCommittedCache, redrawAll]);

  useEffect(() => {
    if (!backgroundImage?.src) {
      const hadBackground = !!backgroundImageRef.current || !!backgroundRectRef.current;
      backgroundImageRef.current = null;
      backgroundRectRef.current = null;
      setBackgroundLoading(false);
      drawBackgroundLayer();
      redrawAll(strokesRef.current, activeStrokeRef.current);
      if (hadBackground) notifySnapshotChanged();
      return;
    }
    let cancelled = false;
    backgroundImageRef.current = null;
    backgroundRectRef.current = null;
    setBackgroundLoading(true);
    drawBackgroundLayer();
    redrawAll(strokesRef.current, activeStrokeRef.current);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      backgroundImageRef.current = img;
      const currentSnapshot = initialSnapshotRef.current;
      const restoredRect = currentSnapshot?.backgroundImage?.imagePath === backgroundImage.src
        ? rectFromBackgroundSnapshot(currentSnapshot.backgroundImage)
        : null;
      backgroundRectRef.current = restoredRect
        ? clampBackgroundRect(
          restoredRect,
          img.naturalWidth,
          img.naturalHeight,
          canvasSizeRef.current.width,
          canvasSizeRef.current.height,
        )
        : calculateDraftBackgroundRect({
          sourceWidth: img.naturalWidth,
          sourceHeight: img.naturalHeight,
          targetWidth: canvasSizeRef.current.width,
          targetHeight: canvasSizeRef.current.height,
        });
      setBackgroundLoading(false);
      drawBackgroundLayer();
      redrawAll(strokesRef.current, activeStrokeRef.current);
      notifySnapshotChanged();
    };
    img.onerror = () => {
      if (cancelled) return;
      backgroundImageRef.current = null;
      backgroundRectRef.current = null;
      setBackgroundLoading(false);
      drawBackgroundLayer();
      redrawAll(strokesRef.current, activeStrokeRef.current);
      notifySnapshotChanged();
    };
    img.src = backgroundImage.src;
    return () => {
      cancelled = true;
    };
  }, [backgroundImage?.src, drawBackgroundLayer, notifySnapshotChanged, redrawAll]);

  const strokesVersionRef = useRef(0);
  useEffect(() => {
    strokesRef.current = strokes;
    const pendingRestore = pendingRestoredStrokesReportRef.current;
    const currentStrokesKey = handwritingStrokesKey(strokes);
    const shouldSkipRestoredReport = !!pendingRestore && (
      (pendingRestore.skipInitialEmpty && strokes.length === 0)
      || currentStrokesKey === pendingRestore.restoredKey
    );
    if (shouldSkipRestoredReport) {
      if (pendingRestore) {
        if (currentStrokesKey === pendingRestore.restoredKey) {
          pendingRestoredStrokesReportRef.current = null;
        } else {
          pendingRestoredStrokesReportRef.current = { ...pendingRestore, skipInitialEmpty: false };
        }
      }
    } else {
      pendingRestoredStrokesReportRef.current = null;
      onStrokeCountChange?.(strokes.length);
    }
    if (strokesVersionRef.current === 0) {
      strokesVersionRef.current = 1;
      return;
    }
    redrawAll(strokes, activeStrokeRef.current);
  }, [onStrokeCountChange, redrawAll, strokes]);

  const finishStroke = useCallback(() => {
    const active = activeStrokeRef.current;
    if (!active) return;
    setClearUndoSnapshot(null);
    activeStrokeRef.current = null;
    updatePointerPreview(null);
    cancelAnimationFrame(rafRef.current);
    dirtyRef.current = false;
    const nextStrokes = [...strokesRef.current, active];
    strokesRef.current = nextStrokes;
    rebuildCommittedCache(nextStrokes);
    redrawAll(nextStrokes, null);
    setStrokes(nextStrokes);
    notifySnapshotChanged();
  }, [notifySnapshotChanged, rebuildCommittedCache, redrawAll, updatePointerPreview]);

  const finishPointerInteraction = useCallback((pointerId: number) => {
    const hadActivePointer = activePointersRef.current.has(pointerId);
    const isNavigationTouch = navigationTouchPointerIdsRef.current.delete(pointerId);
    const isIgnoredPointer = ignoredPointerIdsRef.current.delete(pointerId);
    activePointersRef.current.delete(pointerId);
    if (imagePinchRef.current && activePointersRef.current.size < 2) {
      imagePinchRef.current = null;
      notifySnapshotChanged();
    }
    if (pinchRef.current && activePointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (imageDragRef.current?.pointerId === pointerId) {
      imageDragRef.current = null;
      notifySnapshotChanged();
    }
    if (panDragRef.current?.pointerId === pointerId) {
      panDragRef.current = null;
    }
    if (!hadActivePointer || isNavigationTouch || isIgnoredPointer) return;
    finishStroke();
  }, [finishStroke, notifySnapshotChanged]);

  const beginInkStroke = (
    event: React.PointerEvent<HTMLCanvasElement>,
    box: HTMLDivElement,
    strokeTool: Extract<DrawingTool, 'pen' | 'eraser'>,
  ) => {
    const nextStroke = {
      tool: strokeTool,
      color: strokeTool === 'eraser' ? (background ?? DEFAULT_BG) : penColor,
      width: activeWidth,
      points: [pointFromEvent(
        event.clientX,
        event.clientY,
        event.pressure,
        box,
        viewportRef.current,
        canvasSizeRef.current,
        pointerToolType(event, strokeTool),
        event.timeStamp || Date.now(),
      )],
    };
    activeStrokeRef.current = nextStroke;
    if (strokeTool === 'eraser' || (strokeTool === 'pen' && penPositionIndicatorEnabled)) {
      updatePointerPreview(nextStroke.points[0]);
    }
    const ctx = event.currentTarget.getContext('2d');
    if (ctx) drawStroke(ctx, nextStroke);
    scheduleRedraw();
  };

  const beginTouchNavigation = (
    event: React.PointerEvent<HTMLCanvasElement>,
    box: HTMLDivElement,
  ) => {
    navigationTouchPointerIdsRef.current.add(event.pointerId);
    activePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (activePointersRef.current.size >= 2) {
      if (tool === 'image' && backgroundRectRef.current && backgroundImageRef.current) {
        imagePinchRef.current = createImagePinchGesture(activePointersRef.current, box, viewportRef.current, backgroundRectRef.current);
        pinchRef.current = null;
      } else {
        pinchRef.current = createPinchGesture(activePointersRef.current, box, viewportRef.current, canvasSizeRef.current);
        imagePinchRef.current = null;
      }
    }
    updatePointerPreview(null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || submitting) return;
    event.preventDefault();
    event.stopPropagation();
    setSizePanel(null);
    setMoreOpen(false);
    const target = event.currentTarget;
    const box = boxRef.current;
    if (!box) return;
    if (event.pointerType === 'pen') {
      if (!stylusInputActiveRef.current && activeStrokeRef.current) {
        activeStrokeRef.current = null;
        activePointersRef.current.clear();
        redrawAll(strokesRef.current, null);
      }
      stylusInputActiveRef.current = true;
      navigationTouchPointerIdsRef.current.forEach(pointerId => activePointersRef.current.delete(pointerId));
      navigationTouchPointerIdsRef.current.clear();
      ignoredPointerIdsRef.current.clear();
      pinchRef.current = null;
      imagePinchRef.current = null;
    }
    const touchUsesNavigation = event.pointerType === 'touch' && (
      stylusInputActiveRef.current
      || (!fingerWritingEnabled && (tool === 'pen' || tool === 'eraser'))
    );
    if (touchUsesNavigation) {
      if (activeStrokeRef.current) {
        ignoredPointerIdsRef.current.add(event.pointerId);
        updatePointerPreview(null);
        return;
      }
      beginTouchNavigation(event, box);
      return;
    }
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture improves delivery but must not gate input startup.
    }
    if (activeStrokeRef.current) {
      ignoredPointerIdsRef.current.add(event.pointerId);
      updatePointerPreview(null);
      return;
    }
    activePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (activePointersRef.current.size >= 2) {
      activeStrokeRef.current = null;
      redrawAll(strokesRef.current, null);
      if (tool === 'image' && backgroundRectRef.current && backgroundImageRef.current) {
        imagePinchRef.current = createImagePinchGesture(activePointersRef.current, box, viewportRef.current, backgroundRectRef.current);
        pinchRef.current = null;
      } else {
        pinchRef.current = createPinchGesture(activePointersRef.current, box, viewportRef.current, canvasSizeRef.current);
        imagePinchRef.current = null;
      }
      panDragRef.current = null;
      imageDragRef.current = null;
      updatePointerPreview(null);
      return;
    }
    const strokeTool = tool;
    if (strokeTool === 'image') {
      if (!backgroundRectRef.current || !backgroundImageRef.current) return;
      const startWorld = worldPointFromClient(event.clientX, event.clientY, box, viewportRef.current);
      imageDragRef.current = {
        pointerId: event.pointerId,
        startWorldX: startWorld.x,
        startWorldY: startWorld.y,
        origin: backgroundRectRef.current,
      };
      updatePointerPreview(null);
      return;
    }
    if (strokeTool === 'pan') {
      panDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: viewportRef.current,
      };
      updatePointerPreview(null);
      return;
    }
    beginInkStroke(event, box, strokeTool);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || submitting) return;
    event.preventDefault();
    event.stopPropagation();
    const box = boxRef.current;
    const touchUsesNavigation = event.pointerType === 'touch' && (
      stylusInputActiveRef.current
      || (!fingerWritingEnabled && (tool === 'pen' || tool === 'eraser'))
    );
    if (touchUsesNavigation && !navigationTouchPointerIdsRef.current.has(event.pointerId)) {
      updatePointerPreview(null);
      return;
    }
    const isPenContact = event.pointerType === 'pen' && (event.buttons !== 0 || event.pressure > 0);
    const canRecoverInk = tool === 'pen' || tool === 'eraser';
    if (
      box
      && isPenContact
      && canRecoverInk
      && (!activeStrokeRef.current || !activePointersRef.current.has(event.pointerId))
    ) {
      activeStrokeRef.current = null;
      activePointersRef.current.clear();
      navigationTouchPointerIdsRef.current.clear();
      ignoredPointerIdsRef.current.clear();
      pinchRef.current = null;
      imagePinchRef.current = null;
      panDragRef.current = null;
      imageDragRef.current = null;
      stylusInputActiveRef.current = true;
      activePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture improves delivery but must not gate Pencil recovery.
      }
      redrawAll(strokesRef.current, null);
      beginInkStroke(event, box, tool);
      return;
    }
    if (ignoredPointerIdsRef.current.has(event.pointerId)) return;
    if (activeStrokeRef.current && !activePointersRef.current.has(event.pointerId)) {
      ignoredPointerIdsRef.current.add(event.pointerId);
      return;
    }
    if (!activePointersRef.current.has(event.pointerId)) {
      if (box && tool !== 'pan' && tool !== 'image') {
        const hoverPoint = pointFromEvent(
          event.clientX,
          event.clientY,
          event.pressure,
          box,
          viewportRef.current,
          canvasSizeRef.current,
          pointerToolType(event, tool),
          event.timeStamp || Date.now(),
        );
        if (tool === 'eraser' || (tool === 'pen' && penPositionIndicatorEnabled)) {
          updatePointerPreview(hoverPoint);
        }
      }
      return;
    }
    activePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const pinch = pinchRef.current;
    const imagePinch = imagePinchRef.current;
    if (box && activePointersRef.current.size >= 2) {
      if (imagePinch && backgroundImageRef.current) {
        const nextRect = updateImagePinchRect(activePointersRef.current, box, viewportRef.current, imagePinch);
        if (nextRect) setBackgroundRect(nextRect);
      } else if (pinch) {
        const next = updatePinchViewport(activePointersRef.current, box, pinch);
        if (next) setViewport(next);
      }
      return;
    }
    if (navigationTouchPointerIdsRef.current.has(event.pointerId)) return;
    const imageDrag = imageDragRef.current;
    if (box && imageDrag) {
      const currentWorld = worldPointFromClient(event.clientX, event.clientY, box, viewportRef.current);
      setBackgroundRect({
        ...imageDrag.origin,
        x: imageDrag.origin.x + currentWorld.x - imageDrag.startWorldX,
        y: imageDrag.origin.y + currentWorld.y - imageDrag.startWorldY,
      });
      return;
    }
    const panDrag = panDragRef.current;
    if (panDrag) {
      setViewport({
        offsetX: panDrag.origin.offsetX + event.clientX - panDrag.startX,
        offsetY: panDrag.origin.offsetY + event.clientY - panDrag.startY,
        scale: panDrag.origin.scale,
      });
      return;
    }
    const active = activeStrokeRef.current;
    if (!active || !box) return;

    const native = event.nativeEvent;
    const nativeCoalesced = native.getCoalescedEvents?.() as PointerEvent[] | undefined;
    const coalesced = nativeCoalesced && nativeCoalesced.length > 0
      ? nativeCoalesced
      : ([native] as unknown as PointerEvent[]);
    let latestPointerPreview: InkPoint | null = null;

    for (const evt of coalesced) {
      const rawPoint = pointFromEvent(
        evt.clientX,
        evt.clientY,
        (evt as any).pressure || 0,
        box,
        viewportRef.current,
        canvasSizeRef.current,
        pointerToolType(evt, active.tool),
        evt.timeStamp || native.timeStamp || Date.now(),
      );
      const point = nextInkPoint(active.points, rawPoint);
      if (point) {
        if (active.tool === 'eraser' || (active.tool === 'pen' && penPositionIndicatorEnabled)) {
          latestPointerPreview = point;
        }
        active.points.push(point);
        if (active.points.length < 4) {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (ctx) drawStroke(ctx, active);
        }
      } else if (active.tool === 'eraser' || (active.tool === 'pen' && penPositionIndicatorEnabled)) {
        latestPointerPreview = rawPoint;
      }
    }
    if (latestPointerPreview) updatePointerPreview(latestPointerPreview);
    scheduleRedraw();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // A failed release must not leave the handwriting state unfinished.
    }
    finishPointerInteraction(event.pointerId);
  };

  const handleLostPointerCapture = (event: React.PointerEvent<HTMLCanvasElement>) => {
    finishPointerInteraction(event.pointerId);
  };

  useEffect(() => {
    const handleWindowPointerEnd = (event: PointerEvent) => {
      finishPointerInteraction(event.pointerId);
    };
    window.addEventListener('pointerup', handleWindowPointerEnd, true);
    window.addEventListener('pointercancel', handleWindowPointerEnd, true);
    return () => {
      window.removeEventListener('pointerup', handleWindowPointerEnd, true);
      window.removeEventListener('pointercancel', handleWindowPointerEnd, true);
    };
  }, [finishPointerInteraction]);

  const handlePointerEnter = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'pan' || tool === 'image') return;
    if (event.pointerType === 'touch' && !fingerWritingEnabled) return;
    if (stylusInputActiveRef.current && event.pointerType === 'touch') return;
    const box = boxRef.current;
    if (!box) return;
    updatePointerPreview(pointFromEvent(
      event.clientX,
      event.clientY,
      event.pressure,
      box,
      viewportRef.current,
      canvasSizeRef.current,
      pointerToolType(event, tool),
      event.timeStamp || Date.now(),
    ));
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'pen' && !activePointersRef.current.has(event.pointerId)) {
      stylusInputActiveRef.current = false;
    }
    updatePointerPreview(null);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLCanvasElement>) => {
    event.preventDefault();
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
  };

  const handleUndo = useCallback(() => {
    if (disabled || submitting) return;
    if (strokesRef.current.length === 0 && clearUndoSnapshot) {
      strokesRef.current = clearUndoSnapshot;
      activeStrokeRef.current = null;
      setStrokes(clearUndoSnapshot);
      setClearUndoSnapshot(null);
      rebuildCommittedCache(clearUndoSnapshot);
      redrawAll(clearUndoSnapshot, null);
      notifySnapshotChanged();
      return;
    }
    setClearUndoSnapshot(null);
    const nextStrokes = strokesRef.current.slice(0, -1);
    strokesRef.current = nextStrokes;
    activeStrokeRef.current = null;
    setStrokes(nextStrokes);
    rebuildCommittedCache(nextStrokes);
    redrawAll(nextStrokes, null);
    notifySnapshotChanged();
  }, [clearUndoSnapshot, disabled, notifySnapshotChanged, rebuildCommittedCache, redrawAll, submitting]);

  const handleClear = useCallback(() => {
    if (disabled || submitting) return;
    activeStrokeRef.current = null;
    if (strokesRef.current.length > 0) {
      setClearUndoSnapshot(strokesRef.current);
    }
    strokesRef.current = [];
    setStrokes([]);
    rebuildCommittedCache([]);
    redrawAll([], null);
    notifySnapshotChanged();
  }, [disabled, notifySnapshotChanged, rebuildCommittedCache, redrawAll, submitting]);

  const handleToolButton = (nextTool: DrawingTool) => {
    setTool(nextTool);
    setMoreOpen(false);
    setSizePanel(prev => (prev === nextTool ? null : nextTool));
  };

  const choosePenSize = (size: PenSize) => {
    setTool('pen');
    setPenSize(size);
    setSizePanel(null);
  };

  const choosePenColor = (color: (typeof PEN_COLORS)[number]['value']) => {
    setTool('pen');
    setPenColor(color);
    setSizePanel(null);
  };

  const chooseEraserSize = (size: EraserSize) => {
    setTool('eraser');
    setEraserSize(size);
    setSizePanel(null);
  };

  const clearToolbarLongPress = useCallback(() => {
    if (toolbarLongPressTimerRef.current !== null) {
      window.clearTimeout(toolbarLongPressTimerRef.current);
      toolbarLongPressTimerRef.current = null;
    }
    toolbarLongPressCandidateRef.current = null;
  }, []);

  const isToolbarControlTarget = (target: EventTarget | null) => (
    target instanceof HTMLElement
    && !!target.closest('button, [role="button"], input, select, textarea, a')
  );

  const handleToolbarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (toolbarPlacement !== 'floating-right' || disabled || submitting || event.button !== 0) return;
    if (isToolbarControlTarget(event.target)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const candidate = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originY: toolbarOffsetY,
    };
    toolbarLongPressCandidateRef.current = candidate;
    toolbarLongPressTimerRef.current = window.setTimeout(() => {
      if (toolbarLongPressCandidateRef.current?.pointerId !== candidate.pointerId) return;
      toolbarLongPressTimerRef.current = null;
      toolbarDragRef.current = {
        pointerId: candidate.pointerId,
        startY: candidate.startY,
        originY: candidate.originY,
      };
      suppressToolbarClickRef.current = true;
      setMoreOpen(false);
      setSizePanel(null);
      setToolbarDragging(true);
    }, TOOLBAR_LONG_PRESS_MS);
  };

  const handleToolbarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = toolbarDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      setToolbarOffsetY(clampToolbarOffsetY(drag.originY + event.clientY - drag.startY));
      return;
    }
    const candidate = toolbarLongPressCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
    if (moved > TOOLBAR_LONG_PRESS_MOVE_TOLERANCE) {
      clearToolbarLongPress();
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const handleToolbarPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isToolbarControlTarget(event.target) && !toolbarDragRef.current) return;
    event.preventDefault();
    clearToolbarLongPress();
    if (toolbarDragRef.current?.pointerId === event.pointerId) {
      toolbarDragRef.current = null;
      suppressToolbarClickRef.current = true;
      setToolbarDragging(false);
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleToolbarClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressToolbarClickRef.current) return;
    suppressToolbarClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleToolbarContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (toolbarPlacement !== 'floating-right') return;
    event.preventDefault();
  };

  useImperativeHandle(ref, () => ({
    getSnapshot: getCurrentSnapshot,
    clear: handleClear,
    hasStrokes: () => strokesRef.current.length > 0,
  }), [getCurrentSnapshot, handleClear]);

  const toolbar = (
    <div
      className={`handwriting-toolbar ${toolbarPlacement === 'floating-right' ? 'is-floating-right' : ''}${toolbarDragging ? ' is-dragging' : ''}`}
      aria-label={toolbarPlacement === 'floating-right' ? '手写工具栏，长按可移动' : undefined}
      onPointerDown={handleToolbarPointerDown}
      onPointerMove={handleToolbarPointerMove}
      onPointerUp={handleToolbarPointerEnd}
      onPointerCancel={handleToolbarPointerEnd}
      onClickCapture={handleToolbarClickCapture}
      onContextMenu={handleToolbarContextMenu}
      style={{
        ...toolbarStyle,
        ...(toolbarPlacement === 'floating-right' ? { top: 7 + toolbarOffsetY } : {}),
      }}
    >
      <div className="handwriting-tool-group">
        <button
          type="button"
          onClick={() => handleToolButton('pen')}
          disabled={disabled || submitting}
          aria-label="画笔"
          aria-pressed={tool === 'pen'}
          style={toolModeBtnStyle(tool === 'pen')}
        >
          ✎
        </button>
        {sizePanel === 'pen' && (
          <div className="handwriting-size-popover handwriting-pen-popover">
            <button type="button" aria-label="细笔" aria-pressed={penSize === 'thin'} onClick={() => choosePenSize('thin')} style={visualChoiceBtnStyle(penSize === 'thin')}>
              <span aria-hidden="true" style={dotStyle(PEN_WIDTHS.thin, penColor, penSize === 'thin')} />
            </button>
            <button type="button" aria-label="中笔" aria-pressed={penSize === 'medium'} onClick={() => choosePenSize('medium')} style={visualChoiceBtnStyle(penSize === 'medium')}>
              <span aria-hidden="true" style={dotStyle(PEN_WIDTHS.medium, penColor, penSize === 'medium')} />
            </button>
            <button type="button" aria-label="粗笔" aria-pressed={penSize === 'thick'} onClick={() => choosePenSize('thick')} style={visualChoiceBtnStyle(penSize === 'thick')}>
              <span aria-hidden="true" style={dotStyle(PEN_WIDTHS.thick, penColor, penSize === 'thick')} />
            </button>
            {PEN_COLORS.map(color => (
              <button
                key={color.value}
                type="button"
                aria-label={color.label}
                aria-pressed={penColor === color.value}
                onClick={() => choosePenColor(color.value)}
                style={visualChoiceBtnStyle(penColor === color.value)}
              >
                <span aria-hidden="true" style={colorDotStyle(color.value, penColor === color.value)} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="handwriting-tool-group">
        <button
          type="button"
          onClick={() => handleToolButton('eraser')}
          disabled={disabled || submitting}
          aria-label="橡皮"
          aria-pressed={tool === 'eraser'}
          style={toolModeBtnStyle(tool === 'eraser')}
        >
          ○
        </button>
        {sizePanel === 'eraser' && (
          <div className="handwriting-size-popover handwriting-eraser-popover">
            <button type="button" aria-label="小橡皮" aria-pressed={eraserSize === 'small'} onClick={() => chooseEraserSize('small')} style={visualChoiceBtnStyle(eraserSize === 'small')}>
              <span aria-hidden="true" style={eraserDotStyle(ERASER_WIDTHS.small, eraserSize === 'small')} />
            </button>
            <button type="button" aria-label="大橡皮" aria-pressed={eraserSize === 'large'} onClick={() => chooseEraserSize('large')} style={visualChoiceBtnStyle(eraserSize === 'large')}>
              <span aria-hidden="true" style={eraserDotStyle(ERASER_WIDTHS.large, eraserSize === 'large')} />
            </button>
          </div>
        )}
      </div>
      {!moreOpen && (
        <button
          type="button"
          onClick={() => {
            setMoreOpen(true);
            setSizePanel(null);
          }}
          disabled={disabled || submitting}
          aria-label="更多工具"
          aria-expanded={moreOpen}
          style={toolBtnStyle}
        >
          <span aria-hidden="true" className="handwriting-chevron is-down">›</span>
        </button>
      )}
      {moreOpen && (
        <>
          {enablePanTool && (
            <button
              type="button"
              onClick={() => {
                setTool('pan');
                setSizePanel(null);
                setMoreOpen(false);
              }}
              disabled={disabled || submitting}
              aria-label="移动画布"
              aria-pressed={tool === 'pan'}
              style={toolModeBtnStyle(tool === 'pan')}
            >
              ↔
            </button>
          )}
          {backgroundImage?.src && (
            <button
              type="button"
              onClick={() => {
                setTool('image');
                setSizePanel(null);
                setMoreOpen(false);
              }}
              disabled={disabled || submitting || !backgroundImageRef.current}
              aria-label="移动题图"
              aria-pressed={tool === 'image'}
              style={toolModeBtnStyle(tool === 'image')}
            >
              ⤢
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const next = !fingerWritingEnabled;
              setFingerWritingEnabled(next);
              persistFingerWritingPreference(next);
              setMoreOpen(false);
              setSizePanel(null);
            }}
            disabled={disabled || submitting}
            aria-label="手指书写"
            aria-pressed={fingerWritingEnabled}
            title={fingerWritingEnabled ? '关闭手指书写，避免掌触落墨' : '开启手指书写'}
            style={toolModeBtnStyle(fingerWritingEnabled)}
          >
            指
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !penPositionIndicatorEnabled;
              setPenPositionIndicatorEnabled(next);
              if (!next) updatePointerPreview(null);
              setMoreOpen(false);
              setSizePanel(null);
            }}
            disabled={disabled || submitting}
            aria-label="笔位指示"
            aria-pressed={penPositionIndicatorEnabled}
            style={toolModeBtnStyle(penPositionIndicatorEnabled)}
          >
            ◎
          </button>
          <button type="button" aria-label="撤销" onClick={handleUndo} disabled={disabled || submitting || !canUndo} style={toolBtnStyle}>
            ↶
          </button>
          <button type="button" aria-label="清空" onClick={handleClear} disabled={disabled || submitting || strokes.length === 0} style={toolBtnStyle}>
            ×
          </button>
          {extraToolbarActions}
          <button
            type="button"
            onClick={() => setMoreOpen(false)}
            disabled={disabled || submitting}
            aria-label="收起工具"
            aria-expanded={moreOpen}
            style={toolBtnStyle}
          >
            <span aria-hidden="true" className="handwriting-chevron is-up">›</span>
          </button>
        </>
      )}
    </div>
  );

  return (
    <div>
      {toolbarPlacement === 'top' && toolbar}
      <div
        ref={boxRef}
        className={`handwriting-canvas-viewport${toolbarPlacement === 'floating-right' ? ' has-floating-toolbar' : ''}`}
        style={{ width: '100%', height, position: 'relative', overflow: 'hidden' }}
      >
        {toolbarPlacement === 'floating-right' && toolbar}
        <canvas
          ref={backgroundCanvasRef}
          aria-hidden="true"
          className="handwriting-background-canvas"
          data-handwriting-layer="background"
          style={{
            display: 'block',
            position: 'absolute',
            left: 0,
            top: 0,
            width: canvasSizeRef.current.width || '100%',
            height: canvasSizeRef.current.height || height,
            pointerEvents: 'none',
            borderRadius: 8,
            transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale})`,
            transformOrigin: '0 0',
          }}
        />
        <canvas
          ref={canvasRef}
          aria-label={ariaLabel}
          className="handwriting-canvas"
          data-handwriting-engine="shared"
          data-handwriting-layer="ink"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handleLostPointerCapture}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onTouchEnd={handleTouchEnd}
          onContextMenu={handleContextMenu}
          style={{
            display: 'block',
            position: 'absolute',
            left: 0,
            top: 0,
            zIndex: 1,
            width: canvasSizeRef.current.width || '100%',
            height: canvasSizeRef.current.height || height,
            touchAction: 'none',
            cursor: disabled || submitting ? 'default' : tool === 'pan' || tool === 'image' ? 'grab' : tool === 'eraser' ? 'cell' : 'crosshair',
            transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale})`,
            transformOrigin: '0 0',
            ...canvasStyle,
            background: 'transparent',
          }}
        />
        {backgroundLoading && (
          <div className="handwriting-background-loading">题图载入中...</div>
        )}
        {!disabled && !submitting && (tool === 'eraser' || (tool === 'pen' && penPositionIndicatorEnabled)) && (
          <div
            ref={pointerIndicatorRef}
            aria-hidden="true"
            data-testid={tool === 'pen' ? 'pen-position-indicator' : 'eraser-position-indicator'}
            style={{
              position: 'absolute',
              display: 'none',
              left: 0,
              top: 0,
              width: tool === 'pen'
                ? Math.max(16, activeWidth * viewport.scale + 12)
                : Math.max(8, activeWidth * viewport.scale),
              height: tool === 'pen'
                ? Math.max(16, activeWidth * viewport.scale + 12)
                : Math.max(8, activeWidth * viewport.scale),
              transform: 'translate(-50%, -50%)',
              borderRadius: 999,
              border: tool === 'eraser' ? '1.5px dashed rgba(31,41,51,0.7)' : '1.5px solid rgba(20,145,155,0.72)',
              background: tool === 'eraser' ? 'rgba(255,255,255,0.42)' : 'rgba(20,145,155,0.08)',
              pointerEvents: 'none',
              zIndex: 3,
              boxShadow: tool === 'eraser' && eraserMode === 'background'
                ? '0 0 0 1px rgba(255,253,248,0.95)'
                : '0 0 0 2px rgba(255,255,255,0.72)',
            }}
          />
        )}
      </div>
      {showStrokeCount && <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>{strokes.length} 笔</div>}
    </div>
  );
});

export default HandwritingCanvas;

const toolBtnStyle: CSSProperties = {
  padding: '5px 10px',
  borderRadius: 5,
  border: '1px solid #d9d9d9',
  background: '#fff',
  color: '#666',
  cursor: 'pointer',
  fontSize: 12,
};

function toolModeBtnStyle(active: boolean): CSSProperties {
  return {
    ...toolBtnStyle,
    border: active ? `1px solid ${ACCENT}` : toolBtnStyle.border,
    background: active ? '#e0f5f6' : toolBtnStyle.background,
    color: active ? ACCENT : toolBtnStyle.color,
    fontWeight: active ? 700 : 500,
  };
}

function clampViewport(
  next: ViewportTransform,
  visibleWidth: number,
  visibleHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): ViewportTransform {
  const scale = Math.min(Math.max(next.scale || 1, MIN_VIEWPORT_SCALE), MAX_VIEWPORT_SCALE);
  const scaledWidth = canvasWidth * scale;
  const scaledHeight = canvasHeight * scale;
  const minX = Math.min(0, visibleWidth - scaledWidth);
  const minY = Math.min(0, visibleHeight - scaledHeight);
  return {
    offsetX: Math.max(minX, Math.min(0, next.offsetX)),
    offsetY: Math.max(minY, Math.min(0, next.offsetY)),
    scale,
  };
}

function pointerList(pointers: Map<number, { clientX: number; clientY: number }>) {
  return Array.from(pointers.values()).slice(0, 2);
}

function distanceBetween(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function focusBetween(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
  box: HTMLElement,
) {
  const rect = box.getBoundingClientRect();
  return {
    x: (a.clientX + b.clientX) / 2 - rect.left,
    y: (a.clientY + b.clientY) / 2 - rect.top,
  };
}

function createPinchGesture(
  pointers: Map<number, { clientX: number; clientY: number }>,
  box: HTMLElement,
  origin: ViewportTransform,
  canvasSize: { width: number; height: number },
) {
  const [first, second] = pointerList(pointers);
  if (!first || !second) return null;
  const focus = focusBetween(first, second, box);
  return {
    startDistance: Math.max(1, distanceBetween(first, second)),
    origin,
    worldFocus: {
      x: Math.min(Math.max((focus.x - origin.offsetX) / origin.scale, 0), canvasSize.width),
      y: Math.min(Math.max((focus.y - origin.offsetY) / origin.scale, 0), canvasSize.height),
    },
  };
}

function updatePinchViewport(
  pointers: Map<number, { clientX: number; clientY: number }>,
  box: HTMLElement,
  pinch: {
    startDistance: number;
    worldFocus: { x: number; y: number };
    origin: ViewportTransform;
  },
): ViewportTransform | null {
  const [first, second] = pointerList(pointers);
  if (!first || !second) return null;
  const focus = focusBetween(first, second, box);
  const distance = Math.max(1, distanceBetween(first, second));
  const scale = Math.min(Math.max(pinch.origin.scale * (distance / pinch.startDistance), MIN_VIEWPORT_SCALE), MAX_VIEWPORT_SCALE);
  return {
    offsetX: focus.x - pinch.worldFocus.x * scale,
    offsetY: focus.y - pinch.worldFocus.y * scale,
    scale,
  };
}

function createImagePinchGesture(
  pointers: Map<number, { clientX: number; clientY: number }>,
  box: HTMLElement,
  viewport: ViewportTransform,
  origin: ContainRect,
) {
  const [first, second] = pointerList(pointers);
  if (!first || !second) return null;
  const focus = focusBetween(first, second, box);
  return {
    startDistance: Math.max(1, distanceBetween(first, second)),
    origin,
    worldFocus: {
      x: (focus.x - viewport.offsetX) / viewport.scale,
      y: (focus.y - viewport.offsetY) / viewport.scale,
    },
  };
}

function updateImagePinchRect(
  pointers: Map<number, { clientX: number; clientY: number }>,
  box: HTMLElement,
  viewport: ViewportTransform,
  pinch: {
    startDistance: number;
    worldFocus: { x: number; y: number };
    origin: ContainRect;
  },
): ContainRect | null {
  const [first, second] = pointerList(pointers);
  if (!first || !second) return null;
  const focus = focusBetween(first, second, box);
  const currentWorldFocus = {
    x: (focus.x - viewport.offsetX) / viewport.scale,
    y: (focus.y - viewport.offsetY) / viewport.scale,
  };
  const distance = Math.max(1, distanceBetween(first, second));
  const nextScale = pinch.origin.scale * (distance / pinch.startDistance);
  const scaleRatio = nextScale / Math.max(pinch.origin.scale, 0.001);
  return {
    x: currentWorldFocus.x - (pinch.worldFocus.x - pinch.origin.x) * scaleRatio,
    y: currentWorldFocus.y - (pinch.worldFocus.y - pinch.origin.y) * scaleRatio,
    width: pinch.origin.width * scaleRatio,
    height: pinch.origin.height * scaleRatio,
    scale: nextScale,
  };
}

function visualChoiceBtnStyle(active: boolean): CSSProperties {
  return {
    alignItems: 'center',
    display: 'inline-flex',
    height: 24,
    justifyContent: 'center',
    minWidth: 24,
    padding: 0,
    borderRadius: 6,
    border: '1px solid transparent',
    background: 'transparent',
    color: active ? ACCENT : '#666',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 700 : 500,
  };
}

function dotStyle(size: number, color: string, active: boolean): CSSProperties {
  const visualSize = Math.max(7, size * 1.8);
  return {
    width: visualSize,
    height: visualSize,
    borderRadius: 999,
    background: color,
    display: 'inline-block',
    boxShadow: active ? `0 0 0 3px ${color}2e` : 'none',
  };
}

function colorDotStyle(color: string, active: boolean): CSSProperties {
  return {
    width: 14,
    height: 14,
    borderRadius: 999,
    background: color,
    border: active ? `2px solid ${ACCENT}` : '1px solid rgba(31,41,51,0.16)',
    display: 'inline-block',
    boxShadow: active ? '0 0 0 2px rgba(20,145,155,0.12)' : 'none',
  };
}

function eraserDotStyle(size: number, active: boolean): CSSProperties {
  const visualSize = Math.max(11, size * 0.58);
  return {
    width: visualSize,
    height: visualSize,
    borderRadius: 999,
    border: active ? `2px solid ${ACCENT}` : '1.6px dashed rgba(31,41,51,0.65)',
    background: 'rgba(255,255,255,0.78)',
    display: 'inline-block',
    boxShadow: active ? '0 0 0 2px rgba(20,145,155,0.12)' : 'none',
  };
}
