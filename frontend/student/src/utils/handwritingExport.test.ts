import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HandwritingSnapshot } from '../components/handwriting/HandwritingCanvas';
import { handwritingSnapshotToFile } from './handwritingExport';

function createCanvasContextMock() {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => createCanvasContextMock()) as unknown as HTMLCanvasElement['getContext'];
});

afterEach(() => {
  Object.defineProperty(window, 'devicePixelRatio', {
    value: 1,
    configurable: true,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('handwritingSnapshotToFile', () => {
  it('exports the final answer at the capped device pixel ratio', async () => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 3,
      configurable: true,
    });
    let exportedSize = { width: 0, height: 0 };
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      exportedSize = { width: this.width, height: this.height };
      callback(new Blob(['answer'], { type: 'image/jpeg' }));
    });
    const snapshot: HandwritingSnapshot = {
      version: 1,
      width: 320,
      height: 180,
      strokes: [{
        tool: 'pen',
        color: '#1f2933',
        width: 4,
        points: [{ x: 20, y: 20, t: 1, pressure: 0.5 }],
      }],
    };

    const file = await handwritingSnapshotToFile(snapshot, 'answer.png');

    expect(exportedSize).toEqual({ width: 640, height: 360 });
    expect(file.name).toBe('answer.jpg');
    expect(file.type).toBe('image/jpeg');
  });

  it('caps a large high-DPR handwriting export at the answer image dimension', async () => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      configurable: true,
    });
    let exportedSize = { width: 0, height: 0 };
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      exportedSize = { width: this.width, height: this.height };
      callback(new Blob(['answer'], { type: 'image/jpeg' }));
    });
    const snapshot: HandwritingSnapshot = {
      version: 1,
      width: 1600,
      height: 1200,
      strokes: [{
        tool: 'pen',
        color: '#1f2933',
        width: 4,
        points: [{ x: 20, y: 20, t: 1, pressure: 0.5 }],
      }],
    };

    await handwritingSnapshotToFile(snapshot, 'large-answer.png');

    expect(exportedSize).toEqual({ width: 1800, height: 1350 });
  });

  it('stops export instead of submitting ink without the selected question image', async () => {
    class FailingImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailingImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((_callback: BlobCallback) => {
      throw new Error('An incomplete image must not be encoded');
    });
    const snapshot: HandwritingSnapshot = {
      version: 1,
      width: 320,
      height: 180,
      backgroundImage: {
        imagePath: '/static/questions/force-diagram.png',
        description: '受力分析题图',
        fit: 'contain',
        x: 20,
        y: 24,
        width: 240,
        height: 120,
        scale: 1,
        naturalWidth: 800,
        naturalHeight: 400,
      },
      strokes: [{
        tool: 'pen',
        color: '#1f2933',
        width: 4,
        points: [{ x: 80, y: 80, t: 1, pressure: 0.5 }],
      }],
    };

    await expect(handwritingSnapshotToFile(snapshot, 'force-answer.png')).rejects.toThrow(
      '题图加载失败，无法生成完整作答图片，请检查网络后重试',
    );
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  });

  it('composites the selected question image and ink into one final canvas', async () => {
    const contexts: CanvasRenderingContext2D[] = [];
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => {
      const context = createCanvasContextMock();
      contexts.push(context);
      return context;
    });
    class LoadedImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', LoadedImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(new Blob(['complete-answer'], { type: 'image/jpeg' }));
    });
    const snapshot: HandwritingSnapshot = {
      version: 1,
      width: 320,
      height: 180,
      backgroundImage: {
        imagePath: '/static/questions/force-diagram.png',
        description: '受力分析题图',
        fit: 'contain',
        x: 20,
        y: 24,
        width: 240,
        height: 120,
        scale: 1,
        naturalWidth: 800,
        naturalHeight: 400,
      },
      strokes: [{
        tool: 'pen',
        color: '#1f2933',
        width: 4,
        points: [{ x: 80, y: 80, t: 1, pressure: 0.5 }],
      }],
    };

    const file = await handwritingSnapshotToFile(snapshot, 'force-answer.png');

    expect(contexts[0].drawImage).toHaveBeenNthCalledWith(
      1,
      expect.any(LoadedImage),
      20,
      24,
      240,
      120,
    );
    expect(contexts[0].drawImage).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      0,
      0,
      320,
      180,
    );
    expect(file.name).toBe('force-answer.jpg');
  });
});
