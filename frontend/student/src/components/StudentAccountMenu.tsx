import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './StudentAccountMenu.css';

export default function StudentAccountMenu({ name, onLogout, onNavigate }: {
  name: string; onLogout: () => void; onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.key]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  return <div className="student-account-menu" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button type="button" className="student-account-trigger" ref={trigger}
      aria-expanded={open} aria-controls={popoverId} title={name}
      onClick={() => setOpen(value => !value)}>
      <span className="student-account-name">{name}</span>
    </button>
    {open && <div id={popoverId} className="student-account-popover" role="group" aria-label="账户选项">
      <Link to="/profile" onClick={() => { setOpen(false); onNavigate(); }}>个人中心</Link>
      <button type="button" onClick={() => { setOpen(false); onNavigate(); onLogout(); }}>退出</button>
    </div>}
  </div>;
}
