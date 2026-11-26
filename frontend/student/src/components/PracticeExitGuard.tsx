import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import './PracticeExitGuard.css';

interface ExitGuard {
  unfinished: boolean;
  discard: () => Promise<void>;
}
const ExitContext = createContext<{
  register: (read: () => ExitGuard) => () => void;
  registerBusy: () => () => void;
  requestExit: (action: () => void) => void;
} | null>(null);

export function usePracticeExitGuard(guard: ExitGuard) {
  const context = useContext(ExitContext);
  const current = useRef(guard);
  current.current = guard;
  const register = context?.register;
  useEffect(() => register?.(() => current.current), [register]);
  return context?.requestExit || ((action: () => void) => action());
}

export function usePracticeExit() {
  return useContext(ExitContext)?.requestExit || ((action: () => void) => action());
}

// Submission activity also includes photo upload and paper-batch grading.
export function usePracticeSubmissionActivity(busy: boolean) {
  const register = useContext(ExitContext)?.registerBusy;
  useEffect(() => busy ? register?.() : undefined, [busy, register]);
}

export default function PracticeExitGuard({ children, sessionAvailable }: {
  children: ReactNode;
  sessionAvailable: () => boolean;
}) {
  const guards = useRef(new Set<() => ExitGuard>());
  const busyCount = useRef(0);
  const [, refresh] = useState(0);
  const bypass = useRef(false);
  const [action, setAction] = useState<(() => void) | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const continuing = useRef<HTMLButtonElement>(null);
  const needsConfirmation = () => busyCount.current > 0 || [...guards.current].some(read => read().unfinished);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !bypass.current && sessionAvailable() && needsConfirmation()
    && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  const open = !!action || blocker.state === 'blocked';
  const register = useCallback((read: () => ExitGuard) => {
    guards.current.add(read);
    return () => { guards.current.delete(read); };
  }, []);
  const registerBusy = useCallback(() => {
    busyCount.current += 1;
    refresh(value => value + 1);
    return () => { busyCount.current -= 1; refresh(value => value + 1); };
  }, []);
  const requestExit = useCallback((next: () => void) => {
    if (bypass.current || !needsConfirmation()) next();
    else { setError(''); setAction(() => next); }
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current || !sessionAvailable() || !needsConfirmation()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [sessionAvailable]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    continuing.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, [open]);

  const cancel = () => {
    if (discarding) return;
    setAction(null);
    setError('');
    if (blocker.state === 'blocked') blocker.reset();
  };
  const leave = async () => {
    if (discarding || busyCount.current > 0) return;
    setDiscarding(true);
    setError('');
    try {
      for (const read of [...guards.current]) {
        const guard = read();
        if (guard.unfinished) await guard.discard();
      }
      bypass.current = true;
      setAction(null);
      // A local action (including logout) must run only after confirmation.
      if (blocker.state === 'blocked') blocker.proceed();
      else action?.();
      queueMicrotask(() => { bypass.current = false; });
    } catch {
      setError('未能清理本次草稿，请重试或继续作答。');
    } finally {
      setDiscarding(false);
    }
  };

  return <ExitContext.Provider value={{ register, registerBusy, requestExit }}>
    {children}
    {open && <div className="practice-exit-overlay">
      <div className="practice-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="practice-exit-title"
        aria-describedby="practice-exit-description" ref={dialog} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); cancel(); }
          if (event.key === 'Tab') {
            const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
            const first = buttons[0]; const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <h2 id="practice-exit-title">{busyCount.current > 0 ? '正在提交作答' : '退出作答？'}</h2>
        <p id="practice-exit-description">{busyCount.current > 0
          ? '作答正在保存或批改，请等待完成后再退出。'
          : '本组练习尚未完成，退出将放弃未提交的答案和草稿。已提交、已批改的记录仍会保留。'}</p>
        {error && <p role="alert">{error}</p>}
        <div className="practice-exit-actions">
          <button ref={continuing} type="button" onClick={cancel} disabled={discarding}>继续作答</button>
          <button type="button" className="practice-exit-confirm" onClick={() => { void leave(); }}
            disabled={discarding || busyCount.current > 0}>{discarding ? '正在退出…' : '放弃并退出'}</button>
        </div>
      </div>
    </div>}
  </ExitContext.Provider>;
}
