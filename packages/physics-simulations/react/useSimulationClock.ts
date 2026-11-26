import { useCallback, useEffect, useRef, useState } from 'react';

const PAINT_INTERVAL_MS = 1000 / 30;

export function useSimulationClock(duration: number) {
  const [time, setTimeState] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timeRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const lastPaintRef = useRef(0);

  const seek = useCallback((nextTime: number) => {
    const safeTime = Math.max(0, Math.min(duration, nextTime));
    timeRef.current = safeTime;
    setTimeState(safeTime);
    if (safeTime >= duration) setIsPlaying(false);
  }, [duration]);

  const reset = useCallback(() => {
    timeRef.current = 0;
    lastFrameRef.current = null;
    setTimeState(0);
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (timeRef.current >= duration) {
      timeRef.current = 0;
      setTimeState(0);
    }
    lastFrameRef.current = null;
    setIsPlaying(current => !current);
  }, [duration]);

  useEffect(() => {
    if (timeRef.current > duration) seek(duration);
  }, [duration, seek]);

  useEffect(() => {
    if (!isPlaying) return undefined;

    let animationFrame = 0;
    const tick = (now: number) => {
      const previous = lastFrameRef.current ?? now;
      lastFrameRef.current = now;
      const nextTime = Math.min(duration, timeRef.current + ((now - previous) / 1000) * speed);
      timeRef.current = nextTime;

      if (now - lastPaintRef.current >= PAINT_INTERVAL_MS || nextTime >= duration) {
        lastPaintRef.current = now;
        setTimeState(nextTime);
      }

      if (nextTime >= duration) {
        setIsPlaying(false);
        lastFrameRef.current = null;
        return;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [duration, isPlaying, speed]);

  return {
    time,
    isPlaying,
    speed,
    setSpeed,
    seek,
    reset,
    toggle,
  };
}
