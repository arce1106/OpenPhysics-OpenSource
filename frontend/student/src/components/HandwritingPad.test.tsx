import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import HandwritingPad from './HandwritingPad';
import type { HandwritingSnapshot } from './handwriting/HandwritingCanvas';

vi.mock('../api/client', () => ({
  api: {
    submitPhoto: vi.fn(),
  },
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'student-1',
}));

vi.mock('../utils/handwritingExport', () => ({
  HANDWRITING_BACKGROUND_IMAGE_ERROR: '题图加载失败，无法生成完整作答图片，请检查网络后重试',
  handwritingSnapshotToFile: vi.fn(async () => new File(['answer'], 'handwriting-q1.jpg', { type: 'image/jpeg' })),
}));

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    drawImage: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
  })) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
    callback(new Blob(['answer'], { type: 'image/jpeg' }));
  });
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    width: 320,
    height: 360,
    top: 0,
    right: 320,
    bottom: 360,
    left: 0,
    toJSON: () => ({}),
  }));
});

describe('HandwritingPad', () => {
  beforeEach(async () => {
    const { api } = await import('../api/client');
    const { handwritingSnapshotToFile } = await import('../utils/handwritingExport');
    vi.mocked(api.submitPhoto).mockReset();
    vi.mocked(handwritingSnapshotToFile).mockClear();
  });

  it('submits the final handwriting image only', async () => {
    const { api } = await import('../api/client');
    const { handwritingSnapshotToFile } = await import('../utils/handwritingExport');
    vi.mocked(api.submitPhoto).mockResolvedValue({
      is_correct: true,
      correct_answer: '规范答案',
      explanation: '图片批改',
      mastery_update: {},
      extracted_answer: '图片作答',
    });
    const onResult = vi.fn();

    render(<HandwritingPad questionId="q1" onResult={onResult} getTimeSpentMs={() => 1234} />);

    const canvas = screen.getByLabelText('手写答题区');
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 72, clientY: 72 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 72, clientY: 72 });

    await userEvent.click(screen.getByRole('button', { name: '提交手写答案' }));

    await waitFor(() => {
      expect(api.submitPhoto).toHaveBeenCalledWith(
        'student-1', expect.any(File), 'q1', 1234, undefined,
      );
    });
    expect(handwritingSnapshotToFile).toHaveBeenCalledWith(
      expect.objectContaining({ strokes: expect.any(Array) }),
      'handwriting-q1.png',
    );
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ extracted_answer: '图片作答' }));
  });

  it('does not submit when a selected question image is missing from the snapshot', async () => {
    const { api } = await import('../api/client');
    const { handwritingSnapshotToFile } = await import('../utils/handwritingExport');

    render(
      <HandwritingPad
        questionId="q1"
        onResult={vi.fn()}
        backgroundImage={{ src: '/static/questions/force-diagram.png', description: '受力分析题图' }}
      />,
    );

    const canvas = screen.getByLabelText('手写答题区');
    fireEvent.pointerDown(canvas, { pointerId: 5, pointerType: 'pen', clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 5, pointerType: 'pen', clientX: 72, clientY: 72 });
    fireEvent.pointerUp(canvas, { pointerId: 5, pointerType: 'pen', clientX: 72, clientY: 72 });
    await userEvent.click(screen.getByRole('button', { name: '提交手写答案' }));

    expect(await screen.findByText('题图加载失败，无法生成完整作答图片，请检查网络后重试')).toBeInTheDocument();
    expect(handwritingSnapshotToFile).not.toHaveBeenCalled();
    expect(api.submitPhoto).not.toHaveBeenCalled();
  });

  it('lets students switch between pen and eraser tools', async () => {
    render(<HandwritingPad questionId="q1" onResult={vi.fn()} />);

    const pen = screen.getByRole('button', { name: '画笔' });
    const eraser = screen.getByRole('button', { name: '橡皮' });

    expect(pen).toHaveAttribute('aria-pressed', 'true');
    expect(eraser).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(eraser);

    expect(pen).toHaveAttribute('aria-pressed', 'false');
    expect(eraser).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets students choose pen thickness and eraser size', async () => {
    render(<HandwritingPad questionId="q1" onResult={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '细笔' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '画笔' }));

    const thinPen = screen.getByRole('button', { name: '细笔' });
    const mediumPen = screen.getByRole('button', { name: '中笔' });
    const thickPen = screen.getByRole('button', { name: '粗笔' });
    expect(thinPen).toHaveAttribute('aria-pressed', 'false');
    expect(mediumPen).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(thickPen);
    expect(screen.queryByRole('button', { name: '粗笔' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '画笔' }));
    expect(screen.getByRole('button', { name: '中笔' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '粗笔' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: '橡皮' }));
    expect(screen.queryByRole('button', { name: '细笔' })).not.toBeInTheDocument();
    const smallEraser = screen.getByRole('button', { name: '小橡皮' });
    const largeEraser = screen.getByRole('button', { name: '大橡皮' });
    expect(smallEraser).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '中橡皮' })).not.toBeInTheDocument();

    await userEvent.click(largeEraser);
    await userEvent.click(screen.getByRole('button', { name: '橡皮' }));
    expect(screen.getByRole('button', { name: '大橡皮' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders question image backgrounds on a separate canvas layer', () => {
    const { container } = render(
      <HandwritingPad
        questionId="q1"
        onResult={vi.fn()}
        backgroundImage={{ src: '/static/questions/q1.png', description: '题图' }}
      />,
    );

    expect(container.querySelector('canvas[data-handwriting-layer="background"]')).toBeInTheDocument();
    expect(container.querySelector('canvas[data-handwriting-layer="ink"]')).toBeInTheDocument();
  });

  it('uses a floating right toolbar with folded secondary tools', async () => {
    const { container } = render(<HandwritingPad questionId="q1" onResult={vi.fn()} />);

    expect(container.querySelector('.handwriting-toolbar.is-floating-right')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '移动画布' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '更多工具' }));

    expect(screen.getByRole('button', { name: '移动画布' })).toBeInTheDocument();
  });

  it('does not show the stroke count footer text', () => {
    render(<HandwritingPad questionId="q1" onResult={vi.fn()} />);

    expect(screen.queryByText(/0 笔/)).not.toBeInTheDocument();
  });

  it('does not persist an empty draft on initial mount', async () => {
    const onSnapshotChange = vi.fn();
    render(<HandwritingPad questionId="q1" onResult={vi.fn()} onSnapshotChange={onSnapshotChange} />);

    await waitFor(() => {
      expect(onSnapshotChange).not.toHaveBeenCalled();
    });
  });

  it('persists a handwriting snapshot as soon as strokes change', async () => {
    const onSnapshotChange = vi.fn();
    render(<HandwritingPad questionId="q1" onResult={vi.fn()} onSnapshotChange={onSnapshotChange} />);

    const canvas = screen.getByLabelText('手写答题区');
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 72, clientY: 72 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 72, clientY: 72 });

    await waitFor(() => {
      expect(onSnapshotChange).toHaveBeenCalledWith(expect.objectContaining({
        strokes: expect.arrayContaining([
          expect.objectContaining({
            points: expect.arrayContaining([
              expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
            ]),
          }),
        ]),
      }));
    });
  });

  it('isolates handwriting when the same pad instance switches questions', async () => {
    const q1Snapshots: HandwritingSnapshot[] = [];
    const q2Snapshots: HandwritingSnapshot[] = [];
    const { rerender } = render(
      <HandwritingPad
        questionId="q1"
        initialSnapshot={null}
        onSnapshotChange={snapshot => q1Snapshots.push(structuredClone(snapshot))}
      />,
    );

    const q1Canvas = screen.getByLabelText('手写答题区');
    fireEvent.pointerDown(q1Canvas, {
      pointerId: 470,
      pointerType: 'pen',
      clientX: 30,
      clientY: 30,
      pressure: 0.4,
    });
    fireEvent.pointerMove(q1Canvas, {
      pointerId: 470,
      pointerType: 'pen',
      clientX: 90,
      clientY: 70,
      pressure: 0.45,
    });
    fireEvent.pointerUp(q1Canvas, {
      pointerId: 470,
      pointerType: 'pen',
      clientX: 110,
      clientY: 80,
      pressure: 0,
    });
    await waitFor(() => expect(q1Snapshots).not.toHaveLength(0));

    rerender(
      <HandwritingPad
        questionId="q2"
        initialSnapshot={null}
        onSnapshotChange={snapshot => q2Snapshots.push(structuredClone(snapshot))}
      />,
    );

    expect(screen.getByRole('button', { name: '提交手写答案' })).toBeDisabled();
    const q2Canvas = screen.getByLabelText('手写答题区');
    expect(q2Canvas).not.toBe(q1Canvas);

    fireEvent.pointerDown(q2Canvas, {
      pointerId: 471,
      pointerType: 'pen',
      clientX: 180,
      clientY: 160,
      pressure: 0.4,
    });
    fireEvent.pointerMove(q2Canvas, {
      pointerId: 471,
      pointerType: 'pen',
      clientX: 230,
      clientY: 190,
      pressure: 0.45,
    });
    fireEvent.pointerUp(q2Canvas, {
      pointerId: 471,
      pointerType: 'pen',
      clientX: 250,
      clientY: 200,
      pressure: 0,
    });

    await waitFor(() => expect(q2Snapshots).not.toHaveLength(0));
    expect(q2Snapshots.at(-1)?.strokes).toHaveLength(1);
    expect(q2Snapshots.at(-1)?.strokes[0].points[0]).toMatchObject({ x: 180, y: 160 });
    expect(q2Snapshots.at(-1)?.strokes[0].points).not.toEqual(q1Snapshots.at(-1)?.strokes[0].points);
  });
});
