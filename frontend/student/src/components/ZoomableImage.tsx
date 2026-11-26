import { useEffect, useState } from 'react';
import { resolveAssetUrl } from '../api/baseUrl';

const ULTRAWIDE_QUESTION_IMAGE_RATIO = 3.2;

interface ZoomableImageProps {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}

function rotationKey(src: string): string {
  return `openphysics:image-rotation:${src}`;
}

function normalizeRotation(value: number): number {
  return ((Math.round(value / 90) * 90) % 360 + 360) % 360;
}

function readSavedRotation(src: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(rotationKey(src));
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? normalizeRotation(parsed) : 0;
  } catch {
    return 0;
  }
}

function writeSavedRotation(src: string, rotation: number) {
  if (typeof window === 'undefined') return;
  try {
    const normalized = normalizeRotation(rotation);
    if (normalized === 0) {
      window.localStorage.removeItem(rotationKey(src));
    } else {
      window.localStorage.setItem(rotationKey(src), String(normalized));
    }
  } catch {
    // Image rotation is a display preference; ignore storage failures.
  }
}

function hasClassName(className: string | undefined, token: string): boolean {
  return className?.split(/\s+/).includes(token) ?? false;
}

export default function ZoomableImage({ src, alt, className, style }: ZoomableImageProps) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const resolvedSrc = resolveAssetUrl(src);
  const [savedRotation, setSavedRotation] = useState(() => readSavedRotation(resolvedSrc));
  const [rotation, setRotation] = useState(savedRotation);
  const [previewShapeClass, setPreviewShapeClass] = useState('');

  useEffect(() => {
    const nextRotation = readSavedRotation(resolvedSrc);
    setSavedRotation(nextRotation);
    setRotation(nextRotation);
  }, [resolvedSrc]);

  useEffect(() => {
    setPreviewShapeClass('');
  }, [resolvedSrc, className]);

  useEffect(() => {
    if (!open) return;
    setZoom(1);
    setRotation(savedRotation);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, savedRotation]);

  const rotateBy = (degrees: number) => {
    setRotation(value => normalizeRotation(value + degrees));
  };

  const saveRotation = () => {
    const normalized = normalizeRotation(rotation);
    writeSavedRotation(resolvedSrc, normalized);
    setSavedRotation(normalized);
  };

  const handlePreviewImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    if (!hasClassName(className, 'question-image')) {
      setPreviewShapeClass('');
      return;
    }

    const { naturalWidth, naturalHeight } = event.currentTarget;
    const ratio = naturalHeight > 0 ? naturalWidth / naturalHeight : 0;
    setPreviewShapeClass(
      ratio >= ULTRAWIDE_QUESTION_IMAGE_RATIO ? 'question-image-ultrawide' : '',
    );
  };

  const previewImageClassName = [className, previewShapeClass].filter(Boolean).join(' ') || undefined;

  return (
    <>
      <button
        type="button"
        className="zoomable-image-button"
        aria-label={`放大查看：${alt}`}
        onClick={() => setOpen(true)}
      >
        <span
          className="zoomable-image-preview"
          style={savedRotation ? { transform: `rotate(${savedRotation}deg)` } : undefined}
        >
          <img
            src={resolvedSrc}
            alt={alt}
            className={previewImageClassName}
            loading="lazy"
            decoding="async"
            style={style}
            onLoad={handlePreviewImageLoad}
          />
        </span>
      </button>
      {open && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="图片放大查看"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="image-lightbox-close"
            aria-label="关闭图片放大查看"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
          <div className="image-lightbox-tools" onClick={event => event.stopPropagation()}>
            <button
              type="button"
              aria-label="缩小图片"
              onClick={() => setZoom(value => Math.max(0.75, Number((value - 0.25).toFixed(2))))}
            >
              -
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              aria-label="放大图片"
              onClick={() => setZoom(value => Math.min(3, Number((value + 0.25).toFixed(2))))}
            >
              +
            </button>
            <button
              type="button"
              aria-label="重置图片缩放"
              onClick={() => setZoom(1)}
            >
              重置缩放
            </button>
            <button
              type="button"
              aria-label="图片逆时针旋转"
              onClick={() => rotateBy(-90)}
            >
              ↺
            </button>
            <button
              type="button"
              aria-label="图片顺时针旋转"
              onClick={() => rotateBy(90)}
            >
              ↻
            </button>
            <button
              type="button"
              aria-label="保存图片旋转方向"
              onClick={saveRotation}
            >
              保存方向
            </button>
          </div>
          <img
            src={resolvedSrc}
            alt={`${alt} 放大图`}
            className="image-lightbox-img"
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
            onClick={event => event.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
