import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import LatexSpan from './LatexSpan';
import type { ChatMessage } from '../types';

interface TutorAssistantShellProps {
  ariaLabel: string;
  inputLabel: string;
  placeholder: string;
  prompts: string[];
  messages: ChatMessage[];
  input: string;
  loading: boolean;
  loadingText: string;
  streamText?: string;
  sideActions?: ReactNode;
  inlineTrigger?: boolean;
  onInputChange: (value: string) => void;
  onSend: (message?: string) => void;
}

export default function TutorAssistantShell({
  ariaLabel,
  inputLabel,
  placeholder,
  prompts,
  messages,
  input,
  loading,
  loadingText,
  streamText = '',
  sideActions,
  inlineTrigger = false,
  onInputChange,
  onSend,
}: TutorAssistantShellProps) {
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const [launcherPosition, setLauncherPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [launcherDragging, setLauncherDragging] = useState(false);
  const [compact, setCompact] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const suppressLauncherClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    left: number;
    top: number;
  } | null>(null);
  const launcherDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    left: number;
    top: number;
    moved: boolean;
    captured: boolean;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, streamText, loading, open]);

  useEffect(() => {
    const syncCompact = () => setCompact(window.innerWidth <= 768);
    syncCompact();
    window.addEventListener('resize', syncCompact);
    return () => window.removeEventListener('resize', syncCompact);
  }, []);

  const clampPanelPosition = (left: number, top: number) => {
    const rect = dialogRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 430;
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.max(margin, top),
    };
  };

  const clampLauncherPosition = (left: number, top: number) => {
    const rect = launcherRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 92;
    const height = rect?.height ?? 170;
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop),
    };
  };

  const startLauncherDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = launcherRef.current?.getBoundingClientRect();
    if (!rect) return;
    launcherDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
      captured: false,
    };
  };

  const moveLauncherDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    drag.moved = true;
    suppressLauncherClickRef.current = true;
    setLauncherDragging(true);
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.captured = true;
    }
    event.preventDefault();
    setLauncherPosition(clampLauncherPosition(drag.left + deltaX, drag.top + deltaY));
  };

  const endLauncherDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    launcherDragRef.current = null;
    setLauncherDragging(false);
    if (drag.captured && typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const cancelLauncherClickAfterDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressLauncherClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressLauncherClickRef.current = false;
  };

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (compact || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    setDragging(true);
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    setPanelPosition(clampPanelPosition(
      drag.left + deltaX,
      drag.top + deltaY,
    ));
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const openTutor = () => {
    dragRef.current = null;
    setDragging(false);
    setPanelPosition(null);
    if (open) return;
    setOpen(true);
  };

  const closeTutor = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    setDragging(false);
    setPanelPosition(null);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    onSend();
  };

  const showPrompts = messages.length === 0 && !streamText;

  const dialogLayer = open ? createPortal(
    <div className="question-tutor-layer" role="presentation">
      <div className="question-tutor-scrim" />
      <section
        ref={dialogRef}
        className={['question-tutor-dialog', dragging ? 'is-dragging' : ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-label={ariaLabel}
        aria-modal="false"
        style={panelPosition && !compact ? { left: panelPosition.left, top: panelPosition.top, right: 'auto', bottom: 'auto' } : undefined}
      >
        <header
          className="question-tutor-header"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="question-tutor-title-group">
            <h2>AI助教</h2>
          </div>
          <button
            type="button"
            className="question-tutor-close"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={closeTutor}
            aria-label="关闭AI助教"
          >
            ×
          </button>
        </header>

        <div className="question-tutor-messages" aria-live="polite">
          {showPrompts && (
            <div className="question-tutor-start">
              <div className="question-tutor-prompts" aria-label="快捷追问">
                {prompts.map(prompt => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => onSend(prompt)}
                    disabled={loading}
                    className="question-tutor-prompt"
                  >
                    <span className="question-tutor-prompt-mark" aria-hidden="true" />
                    <span>{prompt}</span>
                    <span className="question-tutor-prompt-arrow" aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((item, index) => (
            <div
              key={`${item.role}-${index}`}
              className={[
                'question-tutor-message',
                item.role === 'user' ? 'is-user' : 'is-assistant',
              ].join(' ')}
            >
              <LatexSpan text={item.content} />
            </div>
          ))}
          {loading && streamText && (
            <div className="question-tutor-message is-assistant">
              <LatexSpan text={streamText} />
            </div>
          )}
          {loading && !streamText && (
            <div className="question-tutor-message is-assistant is-loading">
              {loadingText}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="question-tutor-input-row">
          <div className="question-tutor-composer">
            <textarea
              ref={inputRef}
              aria-label={inputLabel}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={loading}
              rows={1}
              className="question-tutor-input"
            />
            <div className="question-tutor-composer-actions">
              <button
                type="button"
                onClick={() => onSend()}
                disabled={loading || !input.trim()}
                className="question-tutor-send"
                aria-label="发送"
                title="发送"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M4 11.4 19.2 4.7c.7-.3 1.4.4 1.1 1.1l-6.7 15.2c-.3.7-1.3.7-1.5 0l-1.8-6.2-6.2-1.8c-.7-.2-.8-1.2-.1-1.6Z" />
                  <path d="m10.4 14.2 4.2-4.2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {inlineTrigger ? (
        <button type="button" className="grading-result-action-button" onClick={openTutor}
          aria-expanded={open} aria-label="打开AI助教">AI 答疑</button>
      ) : <div
        ref={launcherRef}
        className={['question-tutor-assistant', launcherDragging ? 'is-dragging' : ''].filter(Boolean).join(' ')}
        style={launcherPosition && !compact ? { left: launcherPosition.left, top: launcherPosition.top, right: 'auto', bottom: 'auto', transform: 'none' } : undefined}
        onPointerDown={startLauncherDrag}
        onPointerMove={moveLauncherDrag}
        onPointerUp={endLauncherDrag}
        onPointerCancel={endLauncherDrag}
        onClickCapture={cancelLauncherClickAfterDrag}
      >
        <button
          type="button"
          onClick={openTutor}
          className="question-tutor-trigger"
          aria-expanded={open}
          aria-label="打开AI助教"
        >
          <span className="question-tutor-trigger-icon" aria-hidden="true">
            <span className="question-tutor-teacher-head" />
            <span className="question-tutor-teacher-body" />
          </span>
          <span className="question-tutor-trigger-text">AI助教</span>
        </button>
        {sideActions}
      </div>}
      {dialogLayer}
    </>
  );
}
