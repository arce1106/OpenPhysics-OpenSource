import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANSWER_IMAGE_TARGET_BYTES,
  PAPER_IMAGE_MAX_DIMENSION,
  compressAnswerImageFile,
  compressPaperImageFile,
  scaledImageSize,
} from './imageCompression';

let imageWidth = 1200;
let imageHeight = 900;

class LoadedImage {
  naturalWidth = imageWidth;
  naturalHeight = imageHeight;
  width = imageWidth;
  height = imageHeight;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe('answer image compression', () => {
  beforeEach(() => {
    imageWidth = 1200;
    imageHeight = 900;
    vi.stubGlobal('Image', LoadedImage);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:answer-image'),
      revokeObjectURL: vi.fn(),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    })) as unknown as HTMLCanvasElement['getContext'];
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob(['compressed'], { type: 'image/jpeg' }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps answer images within the upload dimension limit', () => {
    expect(scaledImageSize(4000, 3000, 1800)).toEqual({ width: 1800, height: 1350 });
    expect(scaledImageSize(1200, 900, 1800)).toEqual({ width: 1200, height: 900 });
  });

  it('keeps an already-small JPEG without another lossy encode', async () => {
    const file = new File(['small'], 'answer.jpg', { type: 'image/jpeg' });

    await expect(compressAnswerImageFile(file)).resolves.toBe(file);
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  });

  it('re-encodes a JPEG that fits the dimensions but exceeds the target bytes', async () => {
    const file = new File(
      [new Uint8Array(ANSWER_IMAGE_TARGET_BYTES + 1)],
      'large-answer.jpg',
      { type: 'image/jpeg' },
    );

    const compressed = await compressAnswerImageFile(file);

    expect(compressed).not.toBe(file);
    expect(compressed.name).toBe('large-answer.jpg');
    expect(compressed.type).toBe('image/jpeg');
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/jpeg',
      0.86,
    );
  });

  it('lowers JPEG quality until the encoded file reaches its byte target', async () => {
    const encodedSizes = [ANSWER_IMAGE_TARGET_BYTES + 300, ANSWER_IMAGE_TARGET_BYTES + 100, 600];
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback, _type, _quality) => {
      const size = encodedSizes.shift() ?? 600;
      callback(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
    });
    const file = new File(['png'], 'answer.png', { type: 'image/png' });

    const compressed = await compressAnswerImageFile(file);
    const qualities = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.calls.map(call => call[2] as number);

    expect(compressed.size).toBe(600);
    expect(qualities).toHaveLength(3);
    expect(qualities[0]).toBeCloseTo(0.86);
    expect(qualities[1]).toBeCloseTo(0.8);
    expect(qualities[2]).toBeCloseTo(0.74);
  });

  it('uses the higher-resolution paper profile for a full worksheet page', async () => {
    imageWidth = 4000;
    imageHeight = 3000;
    const contexts: Array<{ drawImage: ReturnType<typeof vi.fn> }> = [];
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => {
      const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
      contexts.push(context);
      return context as unknown as CanvasRenderingContext2D;
    });
    const file = new File(['worksheet'], 'worksheet.png', { type: 'image/png' });

    await compressPaperImageFile(file);

    expect(PAPER_IMAGE_MAX_DIMENSION).toBe(2400);
    expect(contexts[0].drawImage).toHaveBeenCalledWith(
      expect.any(LoadedImage),
      0,
      0,
      2400,
      1800,
    );
  });

  it('keeps reduced dimensions even when a tiny oversized JPEG gains encoded bytes', async () => {
    imageWidth = 4000;
    imageHeight = 3000;
    const file = new File(['tiny'], 'oversized-dimensions.jpg', { type: 'image/jpeg' });

    const compressed = await compressAnswerImageFile(file);

    expect(compressed).not.toBe(file);
    expect(compressed.size).toBeGreaterThan(file.size);
    expect(compressed.type).toBe('image/jpeg');
  });
});
