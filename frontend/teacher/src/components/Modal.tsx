import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A dialog over the page: focus moves into it, Tab stays inside, Escape or a click on the
 * backdrop closes it, and focus returns to whatever opened it.
 */
export default function Modal({ label, onClose, children, className = '' }: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(box.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    (focusable()[0] ?? box.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation"
      onClick={(event) => event.target === event.currentTarget && close.current()}>
      <div ref={box} className={`card dialog ${className}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

/** A scanned image looked at closely without leaving the page. */
export function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <Modal label={alt} onClose={onClose} className="image-viewer">
      <div className="image-viewer-head">
        <strong>{alt}</strong>
        <a href={src} target="_blank" rel="noreferrer">新窗口打开</a>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
      <img src={src} alt={alt} />
    </Modal>
  );
}
