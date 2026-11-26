import { createRef, useRef, useState } from 'react';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import HandwritingCanvas, { type HandwritingCanvasHandle, type HandwritingSnapshot } from './HandwritingCanvas';

function createCanvasContextMock() {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function fireCoalescedPenMove(
  canvas: HTMLElement,
  pointerId: number,
  samples: Array<{ clientX: number; clientY: number; pressure?: number }>,
) {
  const last = samples[samples.length - 1];
  const event = createEvent.pointerMove(canvas, {
    pointerId,
    pointerType: 'pen',
    clientX: last.clientX,
    clientY: last.clientY,
    pressure: last.pressure ?? 0.08,
  });
  Object.defineProperty(event, 'getCoalescedEvents', {
    value: () => samples.map((sample, index) => ({
      pointerId,
      pointerType: 'pen',
      clientX: sample.clientX,
      clientY: sample.clientY,
      pressure: sample.pressure ?? 0.08,
      timeStamp: 1000 + index * 2,
    }) as PointerEvent),
  });
  fireEvent(canvas, event);
}

async function enableFingerWriting() {
  await userEvent.click(screen.getByRole('button', { name: '更多工具' }));
  await userEvent.click(screen.getByRole('button', { name: '手指书写' }));
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => createCanvasContextMock()) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => true);
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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  Object.defineProperty(window, 'devicePixelRatio', {
    value: 1,
    configurable: true,
  });
});

describe('HandwritingCanvas', () => {
  it('provides one shared handwriting engine for pen, eraser, undo, and clear', async () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="共享书写区" />);

    const canvas = screen.getByLabelText('共享书写区');
    expect(canvas).toHaveAttribute('data-handwriting-engine', 'shared');
    expect(screen.getByRole('button', { name: '画笔' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: '橡皮' }));
    expect(screen.getByRole('button', { name: '橡皮' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '小橡皮' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '中橡皮' })).not.toBeInTheDocument();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 80, clientY: 80 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 80, clientY: 80 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: '更多工具' }));
    expect(screen.getByRole('button', { name: '清空' })).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(ref.current?.getSnapshot().strokes).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
  });

  it('updates the draft snapshot immediately after undo before navigation can persist it', async () => {
    const ref = createRef<HandwritingCanvasHandle>();
    const onSnapshotChange = vi.fn();

    render(
      <HandwritingCanvas
        ref={ref}
        ariaLabel="撤销后切题书写区"
        onSnapshotChange={onSnapshotChange}
      />,
    );

    const canvas = screen.getByLabelText('撤销后切题书写区');
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 80, clientY: 80 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 80, clientY: 80 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: '更多工具' }));
    onSnapshotChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));

    expect(ref.current?.getSnapshot().strokes).toHaveLength(0);
    expect(onSnapshotChange).toHaveBeenCalledTimes(1);
  });

  it('uses the selected pen color for new strokes', async () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="彩色书写区" />);

    await userEvent.click(screen.getByRole('button', { name: '画笔' }));
    await userEvent.click(screen.getByRole('button', { name: '红色画笔' }));

    const canvas = screen.getByLabelText('彩色书写区');
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 80, clientY: 80 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 80, clientY: 80 });

    expect(ref.current?.getSnapshot().strokes[0].color).toBe('#d93025');
  });

  it('keeps a tap as a one-point dot stroke', () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="点状书写区" />);

    const canvas = screen.getByLabelText('点状书写区');
    fireEvent.pointerDown(canvas, { pointerId: 7, pointerType: 'pen', clientX: 60, clientY: 60 });
    fireEvent.pointerUp(canvas, { pointerId: 7, pointerType: 'pen', clientX: 60, clientY: 60 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
    expect(ref.current?.getSnapshot().strokes[0].points).toHaveLength(1);
  });

  it('keeps rapid punctuation dots as committed ink after redraw', async () => {
    const ref = createRef<HandwritingCanvasHandle>();
    const contexts: CanvasRenderingContext2D[] = [];
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => {
      const context = createCanvasContextMock();
      contexts.push(context);
      return context;
    });

    render(<HandwritingCanvas ref={ref} ariaLabel="冒号点状书写区" />);

    const canvas = screen.getByLabelText('冒号点状书写区');
    fireEvent.pointerDown(canvas, { pointerId: 11, pointerType: 'pen', clientX: 60, clientY: 60 });
    fireEvent.pointerUp(canvas, { pointerId: 11, pointerType: 'pen', clientX: 60, clientY: 60 });
    fireEvent.pointerDown(canvas, { pointerId: 12, pointerType: 'pen', clientX: 60, clientY: 78 });
    fireEvent.pointerUp(canvas, { pointerId: 12, pointerType: 'pen', clientX: 60, clientY: 78 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(2);
    expect(ref.current?.getSnapshot().strokes.every(stroke => stroke.points.length === 1)).toBe(true);
    contexts.forEach(context => vi.mocked(context.arc).mockClear());
    window.dispatchEvent(new Event('resize'));

    await waitFor(() => {
      const redrawnDots = contexts.reduce(
        (sum, context) => sum + vi.mocked(context.arc).mock.calls.length,
        0,
      );
      expect(redrawnDots).toBeGreaterThanOrEqual(2);
    });
  });

  it('draws a stable dot as soon as the pen touches the canvas', () => {
    const context = createCanvasContextMock();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);

    render(<HandwritingCanvas ariaLabel="灵敏点状书写区" />);

    const canvas = screen.getByLabelText('灵敏点状书写区');
    fireEvent.pointerDown(canvas, { pointerId: 17, pointerType: 'pen', clientX: 60, clientY: 60 });

    expect(context.arc).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
  });

  it('keeps an eight-sample Apple Pencil dot visible after commit and resize', async () => {
    const ref = createRef<HandwritingCanvasHandle>();
    const context = createCanvasContextMock();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);

    render(<HandwritingCanvas ref={ref} ariaLabel="多采样轻点书写区" />);

    const canvas = screen.getByLabelText('多采样轻点书写区');
    fireEvent.pointerDown(canvas, {
      pointerId: 118,
      pointerType: 'pen',
      clientX: 60,
      clientY: 60,
      pressure: 0.08,
    });
    fireCoalescedPenMove(canvas, 118, [
      { clientX: 60.42, clientY: 60.04 },
      { clientX: 59.96, clientY: 60.34 },
      { clientX: 60.48, clientY: 59.94 },
      { clientX: 60.08, clientY: 60.46 },
      { clientX: 60.56, clientY: 60.28 },
      { clientX: 60.18, clientY: 59.88 },
      { clientX: 60.38, clientY: 60.4 },
    ]);

    vi.mocked(context.arc).mockClear();
    fireEvent.pointerUp(canvas, { pointerId: 118, pointerType: 'pen' });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
    expect(context.arc).toHaveBeenCalled();

    vi.mocked(context.arc).mockClear();
    window.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(context.arc).toHaveBeenCalled());
  });

  it('prevents the native touch selection menu after handwriting touch events', () => {
    render(<HandwritingCanvas ariaLabel="禁止选择菜单书写区" />);

    const canvas = screen.getByLabelText('禁止选择菜单书写区');
    const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(touchEnd);

    expect(touchEnd.defaultPrevented).toBe(true);
  });

  it('ignores finger ink and pointer capture by default', () => {
    const ref = createRef<HandwritingCanvasHandle>();
    vi.mocked(HTMLCanvasElement.prototype.setPointerCapture).mockClear();

    render(<HandwritingCanvas ref={ref} ariaLabel="触控笔优先书写区" />);

    const canvas = screen.getByLabelText('触控笔优先书写区');
    fireEvent.pointerDown(canvas, {
      pointerId: 69,
      pointerType: 'touch',
      clientX: 30,
      clientY: 30,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 69,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(canvas, { pointerId: 69, pointerType: 'touch' });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(0);
    expect(HTMLCanvasElement.prototype.setPointerCapture).not.toHaveBeenCalledWith(69);
  });

  it('allows finger ink only after students enable it', async () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="手指书写开关测试区" />);
    await enableFingerWriting();

    const canvas = screen.getByLabelText('手指书写开关测试区');
    fireEvent.pointerDown(canvas, {
      pointerId: 70,
      pointerType: 'touch',
      clientX: 30,
      clientY: 30,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 70,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(canvas, { pointerId: 70, pointerType: 'touch' });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
    expect(ref.current?.getSnapshot().strokes[0].points[0].toolType).toBe(1);
  });

  it('remembers the finger-writing preference when the canvas remounts', async () => {
    const first = render(<HandwritingCanvas ariaLabel="首次手指偏好书写区" />);
    await enableFingerWriting();
    first.unmount();

    const ref = createRef<HandwritingCanvasHandle>();
    render(<HandwritingCanvas ref={ref} ariaLabel="恢复手指偏好书写区" />);
    await userEvent.click(screen.getByRole('button', { name: '更多工具' }));
    expect(screen.getByRole('button', { name: '手指书写' })).toHaveAttribute('aria-pressed', 'true');

    const canvas = screen.getByLabelText('恢复手指偏好书写区');
    fireEvent.pointerDown(canvas, {
      pointerId: 78,
      pointerType: 'touch',
      clientX: 30,
      clientY: 30,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 78,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(canvas, { pointerId: 78, pointerType: 'touch' });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
  });

  it('keeps Pencil ink when pointer capture fails', () => {
    const ref = createRef<HandwritingCanvasHandle>();
    vi.mocked(HTMLCanvasElement.prototype.setPointerCapture).mockImplementationOnce(() => {
      throw new DOMException('Pointer is no longer active', 'NotFoundError');
    });

    render(<HandwritingCanvas ref={ref} ariaLabel="捕获失败降级书写区" />);

    const canvas = screen.getByLabelText('捕获失败降级书写区');
    fireEvent.pointerDown(canvas, {
      pointerId: 79,
      pointerType: 'pen',
      clientX: 30,
      clientY: 30,
      pressure: 0.4,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 79,
      pointerType: 'pen',
      clientX: 100,
      clientY: 100,
      pressure: 0.5,
    });
    fireEvent.pointerUp(canvas, { pointerId: 79, pointerType: 'pen' });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
  });

  it('keeps consecutive Pencil strokes while a palm remains down', () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="掌触持续时连续书写区" />);

    const canvas = screen.getByLabelText('掌触持续时连续书写区');
    fireEvent.pointerDown(canvas, {
      pointerId: 75,
      pointerType: 'touch',
      clientX: 24,
      clientY: 24,
      width: 54,
      height: 46,
    });

    fireEvent.pointerDown(canvas, {
      pointerId: 76,
      pointerType: 'pen',
      clientX: 60,
      clientY: 60,
      pressure: 0.42,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 76,
      pointerType: 'pen',
      clientX: 100,
      clientY: 100,
      pressure: 0.5,
    });
    fireEvent.pointerUp(canvas, { pointerId: 76, pointerType: 'pen' });
    fireEvent.pointerMove(canvas, {
      pointerId: 75,
      pointerType: 'touch',
      clientX: 28,
      clientY: 26,
      width: 54,
      height: 46,
    });

    fireEvent.pointerDown(canvas, {
      pointerId: 77,
      pointerType: 'pen',
      clientX: 140,
      clientY: 60,
      pressure: 0.44,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 77,
      pointerType: 'pen',
      clientX: 180,
      clientY: 100,
      pressure: 0.52,
    });
    fireEvent.pointerUp(canvas, { pointerId: 77, pointerType: 'pen' });
    fireEvent.pointerUp(canvas, { pointerId: 75, pointerType: 'touch' });

    const strokes = ref.current?.getSnapshot().strokes ?? [];
    expect(strokes).toHaveLength(2);
    expect(strokes.every(stroke => stroke.points[0].toolType === 2)).toBe(true);
  });

  it('uses two fingers to move the canvas while finger writing is disabled', () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="触控笔模式双指导航区" workspaceScale={1.4} />);

    const canvas = screen.getByLabelText('触控笔模式双指导航区');
    fireEvent.pointerDown(canvas, { pointerId: 83, pointerType: 'touch', clientX: 120, clientY: 120 });
    fireEvent.pointerDown(canvas, { pointerId: 84, pointerType: 'touch', clientX: 220, clientY: 120 });
    fireEvent.pointerMove(canvas, { pointerId: 83, pointerType: 'touch', clientX: 100, clientY: 90 });
    fireEvent.pointerMove(canvas, { pointerId: 84, pointerType: 'touch', clientX: 200, clientY: 90 });
    fireEvent.pointerUp(canvas, { pointerId: 83, pointerType: 'touch' });
    fireEvent.pointerUp(canvas, { pointerId: 84, pointerType: 'touch' });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(0);
    expect(ref.current?.getSnapshot().viewport).toMatchObject({
      offsetX: -20,
      offsetY: -30,
      scale: 1,
    });
  });

  it('lets a stylus stroke replace an accidental palm touch that started first', () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="防误触书写区" />);

    const canvas = screen.getByLabelText('防误触书写区');
    fireEvent.pointerDown(canvas, { pointerId: 71, pointerType: 'touch', clientX: 20, clientY: 20 });
    fireEvent.pointerDown(canvas, { pointerId: 72, pointerType: 'pen', clientX: 60, clientY: 60, pressure: 0.5 });
    fireEvent.pointerMove(canvas, { pointerId: 72, pointerType: 'pen', clientX: 90, clientY: 90, pressure: 0.5 });
    fireEvent.pointerUp(canvas, { pointerId: 72, pointerType: 'pen', clientX: 90, clientY: 90, pressure: 0.5 });

    const strokes = ref.current?.getSnapshot().strokes ?? [];
    expect(strokes).toHaveLength(1);
    expect(strokes[0].points.length).toBeGreaterThan(1);
  });

  it('recovers Pencil ink when a palm wins the pointerdown race', () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="掌触抢占后恢复书写区" />);

    const canvas = screen.getByLabelText('掌触抢占后恢复书写区');
    fireEvent.pointerDown(canvas, {
      pointerId: 73,
      pointerType: 'touch',
      clientX: 24,
      clientY: 24,
      width: 54,
      height: 46,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 74,
      pointerType: 'pen',
      buttons: 1,
      pressure: 0.42,
      clientX: 60,
      clientY: 60,
    });
    fireEvent.pointerUp(canvas, { pointerId: 73, pointerType: 'touch' });
    fireEvent.pointerMove(canvas, {
      pointerId: 74,
      pointerType: 'pen',
      buttons: 1,
      pressure: 0.5,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(canvas, { pointerId: 74, pointerType: 'pen' });

    const strokes = ref.current?.getSnapshot().strokes ?? [];
    expect(strokes).toHaveLength(1);
    expect(strokes[0].points[0].toolType).toBe(2);
    expect(strokes[0].points.length).toBeGreaterThan(1);
  });

  it('redraws a tap from committed ink before effects can clear temporary ink', () => {
    const context = createCanvasContextMock();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);

    render(<HandwritingCanvas ariaLabel="短点收笔书写区" />);

    const canvas = screen.getByLabelText('短点收笔书写区');
    vi.mocked(context.drawImage).mockClear();
    fireEvent.pointerDown(canvas, { pointerId: 21, pointerType: 'pen', clientX: 60, clientY: 60 });
    fireEvent.pointerUp(canvas, { pointerId: 21, pointerType: 'pen', clientX: 60, clientY: 60 });

    expect(context.drawImage).toHaveBeenCalled();
  });

  it('keeps a fast stylus tap when a previous draft echo lands mid-stroke', async () => {
    vi.useFakeTimers();
    const canvasRef = createRef<HandwritingCanvasHandle>();

    function DelayedEchoCanvas() {
      const [snapshot, setSnapshot] = useState<HandwritingSnapshot | null>(null);
      return (
        <HandwritingCanvas
          ref={canvasRef}
          ariaLabel="草稿回写撞笔书写区"
          initialSnapshot={snapshot}
          onSnapshotChange={() => {
            window.setTimeout(() => {
              const next = canvasRef.current?.getSnapshot();
              if (next) setSnapshot(next);
            }, 5);
          }}
        />
      );
    }

    render(<DelayedEchoCanvas />);

    const canvas = screen.getByLabelText('草稿回写撞笔书写区');
    fireEvent.pointerDown(canvas, { pointerId: 31, pointerType: 'pen', clientX: 30, clientY: 30 });
    fireEvent.pointerUp(canvas, { pointerId: 31, pointerType: 'pen', clientX: 30, clientY: 30 });

    fireEvent.pointerDown(canvas, { pointerId: 32, pointerType: 'pen', clientX: 42, clientY: 42 });
    act(() => {
      vi.advanceTimersByTime(5);
    });
    fireEvent.pointerUp(canvas, { pointerId: 32, pointerType: 'pen', clientX: 42, clientY: 42 });

    expect(canvasRef.current?.getSnapshot().strokes).toHaveLength(2);

    vi.useRealTimers();
  });

  it('commits a stylus tap when pointerup is delivered outside the canvas', () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="窗口收笔书写区" />);

    const canvas = screen.getByLabelText('窗口收笔书写区');
    fireEvent.pointerDown(canvas, { pointerId: 41, pointerType: 'pen', clientX: 60, clientY: 60 });
    fireEvent.pointerUp(window, { pointerId: 41, pointerType: 'pen', clientX: 60, clientY: 60 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
  });

  it('commits a stylus tap when pointer capture is lost before pointerup', () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="捕获丢失书写区" />);

    const canvas = screen.getByLabelText('捕获丢失书写区');
    fireEvent.pointerDown(canvas, { pointerId: 42, pointerType: 'pen', clientX: 60, clientY: 60 });
    fireEvent.lostPointerCapture(canvas, { pointerId: 42, pointerType: 'pen', clientX: 60, clientY: 60 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
  });

  it('keeps visible ink as a dot after a tiny first pointer move', async () => {
    const context = createCanvasContextMock();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);

    render(<HandwritingCanvas ariaLabel="起笔可见书写区" />);

    const canvas = screen.getByLabelText('起笔可见书写区');
    fireEvent.pointerDown(canvas, { pointerId: 19, pointerType: 'pen', clientX: 60, clientY: 60, pressure: 0.4 });
    fireEvent.pointerMove(canvas, { pointerId: 19, pointerType: 'pen', clientX: 60.4, clientY: 60.2, pressure: 0.4 });

    expect(context.arc).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
    expect(context.stroke).not.toHaveBeenCalled();
  });

  it('redraws committed ink at CSS canvas size after the stroke finishes', async () => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      configurable: true,
    });
    const context = createCanvasContextMock();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);

    render(<HandwritingCanvas ariaLabel="收笔稳定书写区" />);

    const canvas = screen.getByLabelText('收笔稳定书写区') as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { pointerId: 41, pointerType: 'pen', clientX: 60, clientY: 60, pressure: 0.4 });
    fireEvent.pointerMove(canvas, { pointerId: 41, pointerType: 'pen', clientX: 120, clientY: 120, pressure: 0.4 });
    fireEvent.pointerUp(canvas, { pointerId: 41, pointerType: 'pen', clientX: 120, clientY: 120, pressure: 0.4 });

    await waitFor(() => {
      expect(context.drawImage).toHaveBeenCalled();
    });
    const cacheDrawCalls = vi.mocked(context.drawImage).mock.calls
      .filter(call => call[0] instanceof HTMLCanvasElement);
    const latestCacheDraw = cacheDrawCalls.at(-1);

    expect(latestCacheDraw).toHaveLength(5);
    expect(latestCacheDraw?.slice(1)).toEqual([
      0,
      0,
      Number.parseFloat(canvas.style.width),
      Number.parseFloat(canvas.style.height),
    ]);
  });

  it('ignores an extra touch while handwriting instead of zooming the canvas', async () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="防误触书写区" workspaceScale={1.4} />);
    await enableFingerWriting();

    const canvas = screen.getByLabelText('防误触书写区');
    fireEvent.pointerDown(canvas, { pointerId: 31, pointerType: 'touch', clientX: 60, clientY: 60 });
    fireEvent.pointerMove(canvas, { pointerId: 31, pointerType: 'touch', clientX: 90, clientY: 90 });
    fireEvent.pointerDown(canvas, { pointerId: 32, pointerType: 'touch', clientX: 160, clientY: 160 });
    fireEvent.pointerMove(canvas, { pointerId: 32, pointerType: 'touch', clientX: 220, clientY: 220 });
    fireEvent.pointerMove(canvas, { pointerId: 31, pointerType: 'touch', clientX: 120, clientY: 120 });
    fireEvent.pointerUp(canvas, { pointerId: 32, pointerType: 'touch', clientX: 220, clientY: 220 });
    fireEvent.pointerUp(canvas, { pointerId: 31, pointerType: 'touch', clientX: 120, clientY: 120 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
    expect(ref.current?.getSnapshot().viewport).toMatchObject({
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    });
  });

  it('keeps Pencil ink moving while a palm remains on the canvas', () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="Pencil 掌触隔离书写区" workspaceScale={1.4} />);

    const canvas = screen.getByLabelText('Pencil 掌触隔离书写区');
    fireEvent.pointerDown(canvas, {
      pointerId: 41,
      pointerType: 'pen',
      clientX: 40,
      clientY: 40,
      pressure: 0.45,
    });
    fireEvent.pointerDown(canvas, {
      pointerId: 42,
      pointerType: 'touch',
      clientX: 180,
      clientY: 180,
      width: 52,
      height: 44,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 41,
      pointerType: 'pen',
      clientX: 80,
      clientY: 80,
      pressure: 0.5,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 42,
      pointerType: 'touch',
      clientX: 184,
      clientY: 182,
      width: 52,
      height: 44,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 41,
      pointerType: 'pen',
      clientX: 120,
      clientY: 120,
      pressure: 0.52,
    });
    fireEvent.pointerUp(canvas, { pointerId: 42, pointerType: 'touch' });
    fireEvent.pointerMove(canvas, {
      pointerId: 41,
      pointerType: 'pen',
      clientX: 150,
      clientY: 150,
      pressure: 0.48,
    });
    fireEvent.pointerUp(canvas, { pointerId: 41, pointerType: 'pen' });

    const snapshot = ref.current?.getSnapshot();
    expect(snapshot?.strokes).toHaveLength(1);
    expect(snapshot?.strokes[0].points.length).toBeGreaterThanOrEqual(4);
    expect(snapshot?.viewport).toMatchObject({ offsetX: 0, offsetY: 0, scale: 1 });
  });

  it('does not show a circular pointer preview while writing with the pen by default', async () => {
    const { container } = render(<HandwritingCanvas ariaLabel="无预览圆圈书写区" />);

    const canvas = screen.getByLabelText('无预览圆圈书写区');

    fireEvent.pointerEnter(canvas, { pointerId: 8, pointerType: 'pen', clientX: 60, clientY: 60 });
    fireEvent.pointerDown(canvas, { pointerId: 8, pointerType: 'pen', clientX: 60, clientY: 60 });
    fireEvent.pointerMove(canvas, { pointerId: 8, pointerType: 'pen', clientX: 61, clientY: 61 });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.querySelector('[style*="border-radius: 999"]')).toBeNull();
  });

  it('can show a pen position indicator when enabled for screen recording', () => {
    render(<HandwritingCanvas ariaLabel="演示笔位书写区" showPenPositionIndicator />);

    const canvas = screen.getByLabelText('演示笔位书写区');
    fireEvent.pointerEnter(canvas, { pointerId: 28, pointerType: 'pen', clientX: 70, clientY: 80 });

    expect(screen.getByTestId('pen-position-indicator')).toBeInTheDocument();
  });

  it('moves the optional pen position indicator while the stylus is hovering', () => {
    render(<HandwritingCanvas ariaLabel="悬停笔位书写区" showPenPositionIndicator />);

    const canvas = screen.getByLabelText('悬停笔位书写区');
    fireEvent.pointerEnter(canvas, { pointerId: 28, pointerType: 'pen', clientX: 70, clientY: 80 });
    fireEvent.pointerMove(canvas, {
      pointerId: 28,
      pointerType: 'pen',
      clientX: 110,
      clientY: 120,
      buttons: 0,
    });

    expect(screen.getByTestId('pen-position-indicator')).toHaveStyle({
      left: '110px',
      top: '120px',
    });
  });

  it('does not let a hovering pointer block the next touch stroke', async () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="悬停后触摸书写区" />);
    await enableFingerWriting();

    const canvas = screen.getByLabelText('悬停后触摸书写区');
    fireEvent.pointerMove(canvas, {
      pointerId: 81,
      pointerType: 'pen',
      clientX: 30,
      clientY: 30,
      buttons: 0,
    });
    fireEvent.pointerDown(canvas, { pointerId: 82, pointerType: 'touch', clientX: 60, clientY: 60 });
    fireEvent.pointerMove(canvas, { pointerId: 82, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 82, pointerType: 'touch', clientX: 100, clientY: 100 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
  });

  it('lets the student toggle the pen position indicator from the toolbar', async () => {
    render(<HandwritingCanvas ariaLabel="可切换笔位书写区" />);

    await userEvent.click(screen.getByRole('button', { name: '更多工具' }));
    await userEvent.click(screen.getByRole('button', { name: '笔位指示' }));

    const canvas = screen.getByLabelText('可切换笔位书写区');
    fireEvent.pointerEnter(canvas, { pointerId: 29, pointerType: 'pen', clientX: 70, clientY: 80 });
    expect(screen.getByTestId('pen-position-indicator')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '更多工具' }));
    await userEvent.click(screen.getByRole('button', { name: '笔位指示' }));

    expect(screen.queryByTestId('pen-position-indicator')).not.toBeInTheDocument();
  });

  it('folds the pen size panel when writing starts on the canvas', async () => {
    render(<HandwritingCanvas ariaLabel="收起笔设置书写区" />);

    await userEvent.click(screen.getByRole('button', { name: '画笔' }));
    expect(screen.getByRole('button', { name: '细笔' })).toBeInTheDocument();

    const canvas = screen.getByLabelText('收起笔设置书写区');
    fireEvent.pointerDown(canvas, { pointerId: 18, pointerType: 'pen', clientX: 60, clientY: 60 });

    expect(screen.queryByRole('button', { name: '细笔' })).not.toBeInTheDocument();
  });

  it('ignores touch strokes after Apple Pencil activates handwriting', () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="Apple Pencil 优先书写区" />);

    const canvas = screen.getByLabelText('Apple Pencil 优先书写区');
    fireEvent.pointerDown(canvas, { pointerId: 11, pointerType: 'pen', clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 11, pointerType: 'pen', clientX: 80, clientY: 80 });
    fireEvent.pointerUp(canvas, { pointerId: 11, pointerType: 'pen', clientX: 80, clientY: 80 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);

    fireEvent.pointerDown(canvas, { pointerId: 12, pointerType: 'touch', clientX: 120, clientY: 120 });
    fireEvent.pointerMove(canvas, { pointerId: 12, pointerType: 'touch', clientX: 180, clientY: 180 });
    fireEvent.pointerUp(canvas, { pointerId: 12, pointerType: 'touch', clientX: 180, clientY: 180 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
  });

  it('lets touch writing resume after the stylus leaves the canvas', async () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="笔手切换书写区" />);
    await enableFingerWriting();

    const canvas = screen.getByLabelText('笔手切换书写区');
    fireEvent.pointerDown(canvas, { pointerId: 91, pointerType: 'pen', clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 91, pointerType: 'pen', clientX: 80, clientY: 80 });
    fireEvent.pointerUp(canvas, { pointerId: 91, pointerType: 'pen', clientX: 80, clientY: 80 });
    fireEvent.pointerLeave(canvas, { pointerId: 91, pointerType: 'pen', clientX: 80, clientY: 80 });

    fireEvent.pointerDown(canvas, { pointerId: 92, pointerType: 'touch', clientX: 120, clientY: 120 });
    fireEvent.pointerMove(canvas, { pointerId: 92, pointerType: 'touch', clientX: 180, clientY: 180 });
    fireEvent.pointerUp(canvas, { pointerId: 92, pointerType: 'touch', clientX: 180, clientY: 180 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(2);
  });

  it('keeps two-finger touch navigation available after Apple Pencil activates handwriting', async () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="Apple Pencil 双指导航书写区" workspaceScale={1.4} />);
    await enableFingerWriting();

    const canvas = screen.getByLabelText('Apple Pencil 双指导航书写区');
    fireEvent.pointerDown(canvas, { pointerId: 21, pointerType: 'pen', clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 21, pointerType: 'pen', clientX: 80, clientY: 80 });
    fireEvent.pointerUp(canvas, { pointerId: 21, pointerType: 'pen', clientX: 80, clientY: 80 });

    fireEvent.pointerDown(canvas, { pointerId: 22, pointerType: 'touch', clientX: 120, clientY: 120 });
    fireEvent.pointerDown(canvas, { pointerId: 23, pointerType: 'touch', clientX: 220, clientY: 120 });
    fireEvent.pointerMove(canvas, { pointerId: 22, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 23, pointerType: 'touch', clientX: 200, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 22, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 23, pointerType: 'touch', clientX: 200, clientY: 100 });

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
    expect(ref.current?.getSnapshot().viewport).toMatchObject({
      offsetX: -20,
      offsetY: -20,
      scale: 1,
    });
  });

  it('updates the exported viewport when the canvas is moved', async () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(<HandwritingCanvas ref={ref} ariaLabel="可移动书写区" enablePanTool workspaceScale={1.4} />);

    const canvas = screen.getByLabelText('可移动书写区');
    await userEvent.click(screen.getByRole('button', { name: '更多工具' }));
    await userEvent.click(screen.getByRole('button', { name: '移动画布' }));

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 120, clientY: 120 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 70, clientY: 90 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 70, clientY: 90 });

    expect(ref.current?.getSnapshot().viewport).toMatchObject({
      offsetX: -50,
      offsetY: -30,
      scale: 1,
    });
  });

  it('keeps secondary tools folded until students open more tools', async () => {
    render(<HandwritingCanvas ariaLabel="折叠工具书写区" enablePanTool />);

    expect(screen.queryByRole('button', { name: '移动画布' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '更多工具' }));

    expect(screen.getByRole('button', { name: '移动画布' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清空' })).toBeInTheDocument();
  });

  it('allows the floating toolbar to move vertically after a long press', () => {
    vi.useFakeTimers();
    const { container } = render(
      <HandwritingCanvas
        ariaLabel="工具栏可移动书写区"
        toolbarPlacement="floating-right"
      />,
    );

    const toolbar = container.querySelector('.handwriting-toolbar.is-floating-right') as HTMLElement;
    expect(toolbar.style.top).toBe('7px');

    fireEvent.pointerDown(toolbar, { pointerId: 1, clientX: 12, clientY: 12, button: 0 });
    vi.advanceTimersByTime(430);
    fireEvent.pointerMove(toolbar, { pointerId: 1, clientX: 12, clientY: 80 });
    fireEvent.pointerUp(toolbar, { pointerId: 1, clientX: 12, clientY: 80 });

    expect(parseFloat(toolbar.style.top)).toBeGreaterThan(7);
    vi.useRealTimers();
  });

  it('restores strokes and viewport from an existing draft snapshot', () => {
    const ref = createRef<HandwritingCanvasHandle>();

    render(
      <HandwritingCanvas
        ref={ref}
        ariaLabel="恢复草稿区"
        initialSnapshot={{
          version: 1,
          width: 448,
          height: 504,
          viewport: { offsetX: -32, offsetY: -18, scale: 1.2 },
          strokes: [
            {
              tool: 'pen',
              color: '#1f2933',
              width: 2.5,
              points: [
                { x: 10, y: 10, t: 1000 },
                { x: 30, y: 24, t: 1040 },
              ],
            },
          ],
        }}
        workspaceScale={1.4}
      />,
    );

    expect(ref.current?.getSnapshot().strokes).toHaveLength(1);
    expect(ref.current?.getSnapshot().viewport).toMatchObject({
      offsetX: -32,
      offsetY: -18,
      scale: 1.2,
    });
  });

  it('draws restored history before any new pointer input', () => {
    const contexts = new Map<HTMLCanvasElement, ReturnType<typeof createCanvasContextMock>>();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function getContext(this: HTMLCanvasElement) {
      let context = contexts.get(this);
      if (!context) {
        context = createCanvasContextMock();
        contexts.set(this, context);
      }
      return context;
    } as unknown as HTMLCanvasElement['getContext']);

    render(
      <HandwritingCanvas
        ariaLabel="历史痕迹立即恢复区"
        initialSnapshot={{
          version: 1,
          width: 448,
          height: 504,
          strokes: [{
            tool: 'pen',
            color: '#1f2933',
            width: 4,
            points: [
              { x: 20, y: 30, t: 1000, toolType: 2 },
              { x: 80, y: 90, t: 1040, toolType: 2 },
            ],
          }],
        }}
      />,
    );

    const canvas = screen.getByLabelText('历史痕迹立即恢复区') as HTMLCanvasElement;
    const visibleContext = contexts.get(canvas)!;
    const committedCanvas = [...contexts.keys()].find(candidate => (
      candidate !== canvas && !candidate.dataset.handwritingLayer
    ));
    const committedContext = committedCanvas ? contexts.get(committedCanvas) : null;
    const firstCommittedInkCall = Math.min(
      committedContext ? vi.mocked(committedContext.fill).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY,
      committedContext ? vi.mocked(committedContext.stroke).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY,
    );
    const firstVisibleCacheCopy = vi.mocked(visibleContext.drawImage).mock.invocationCallOrder[0];

    expect(committedContext).toBeTruthy();
    expect(firstCommittedInkCall).toBeLessThan(firstVisibleCacheCopy);
  });

  it('does not reapply an equivalent draft snapshot object', () => {
    const ref = createRef<HandwritingCanvasHandle>();
    const snapshot = {
      version: 1 as const,
      width: 448,
      height: 504,
      viewport: { offsetX: -32, offsetY: -18, scale: 1.2 },
      strokes: [
        {
          tool: 'pen' as const,
          color: '#1f2933',
          width: 2.5,
          points: [
            { x: 10, y: 10, t: 1000 },
            { x: 30, y: 24, t: 1040 },
          ],
        },
      ],
    };

    const { rerender } = render(
      <HandwritingCanvas
        ref={ref}
        ariaLabel="稳定恢复草稿区"
        initialSnapshot={snapshot}
        workspaceScale={1.4}
      />,
    );

    const restoredStrokes = ref.current?.getSnapshot().strokes;

    rerender(
      <HandwritingCanvas
        ref={ref}
        ariaLabel="稳定恢复草稿区"
        initialSnapshot={{ ...snapshot, strokes: [...snapshot.strokes] }}
        workspaceScale={1.4}
      />,
    );

    expect(ref.current?.getSnapshot().strokes).toBe(restoredStrokes);
  });

  it('moves a loaded question image background in image move mode', async () => {
    const OriginalImage = window.Image;
    class MockImage {
      naturalWidth = 200;
      naturalHeight = 100;
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', MockImage);

    const ref = createRef<HandwritingCanvasHandle>();
    render(
      <HandwritingCanvas
        ref={ref}
        ariaLabel="可移动题图草稿区"
        backgroundImage={{ src: '/question.png', description: '题图' }}
      />,
    );

    await screen.findByRole('button', { name: '更多工具' });
    await userEvent.click(screen.getByRole('button', { name: '更多工具' }));
    const moveImageButton = await screen.findByRole('button', { name: '移动题图' });
    await userEvent.click(moveImageButton);
    const before = ref.current?.getSnapshot().backgroundImage;
    expect(before).toBeTruthy();

    const canvas = screen.getByLabelText('可移动题图草稿区');
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 28, clientY: 28 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 68, clientY: 74 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 68, clientY: 74 });

    const after = ref.current?.getSnapshot().backgroundImage;
    expect(after?.x).toBeGreaterThan(before!.x);
    expect(after?.y).toBeGreaterThan(before!.y);

    vi.stubGlobal('Image', OriginalImage);
  });

  it('does not reapply its own echoed snapshot after writing over a question image', async () => {
    const OriginalImage = window.Image;
    class MockImage {
      naturalWidth = 200;
      naturalHeight = 100;
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', MockImage);

    const clearRect = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      arc: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      clearRect,
      fill: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
    })) as unknown as HTMLCanvasElement['getContext'];

    let lastSnapshot: HandwritingSnapshot | null = null;

    function EchoSnapshotCanvas() {
      const ref = useRef<HandwritingCanvasHandle | null>(null);
      const [snapshot, setSnapshot] = useState<HandwritingSnapshot | null>(null);
      return (
        <HandwritingCanvas
          ref={ref}
          ariaLabel="题图回写草稿区"
          backgroundImage={{ src: '/question.png', description: '题图' }}
          initialSnapshot={snapshot}
          onSnapshotChange={() => {
            const next = ref.current?.getSnapshot();
            if (next) {
              lastSnapshot = next;
              setSnapshot(next);
            }
          }}
        />
      );
    }

    render(<EchoSnapshotCanvas />);
    await waitFor(() => expect(screen.queryByText('题图载入中...')).not.toBeInTheDocument());
    await waitFor(() => expect(lastSnapshot?.backgroundImage?.imagePath).toBe('/question.png'));

    const canvas = screen.getByLabelText('题图回写草稿区');
    clearRect.mockClear();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 80, clientY: 80 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 80, clientY: 80 });

    await waitFor(() => expect(lastSnapshot?.strokes).toHaveLength(1));
    expect(clearRect.mock.calls.length).toBeLessThan(10);
    vi.stubGlobal('Image', OriginalImage);
  });

});
