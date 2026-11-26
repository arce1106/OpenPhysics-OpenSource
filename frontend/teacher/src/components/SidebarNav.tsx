import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api } from '../api';
import type { TeacherClassSummary } from '../types';

function NavIcon({ name }: { name: 'tasks' | 'compose' | 'classes' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'tasks' ? <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></>
        : name === 'compose' ? <><path d="m15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15z" /><path d="M13 20h7" /></>
          : <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" /></>}
    </svg>
  );
}

/** Fetch the teacher's class directory only when it is opened. */
export default function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [classes, setClasses] = useState<TeacherClassSummary[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const classSection = useRef<HTMLDivElement>(null);
  const directoryToggle = useRef<HTMLButtonElement>(null);
  const homeworkActive = pathname === '/papers' || pathname.startsWith('/assignments/');

  useEffect(() => {
    if (collapsed) setOpen(false);
  }, [collapsed]);
  useEffect(() => {
    if (!pathname.startsWith('/classes')) setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (collapsed && !classSection.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (classSection.current?.contains(document.activeElement)) directoryToggle.current?.focus();
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, collapsed]);
  useEffect(() => {
    if (!open || classes) return;
    let active = true;
    setError('');
    api.classes().then((next) => active && setClasses(next))
      .catch((err) => active && setError(err instanceof Error ? err.message : '班级加载失败'));
    return () => { active = false; };
  }, [open, classes, retry]);

  return (
    <nav className="side-nav" aria-label="主导航">
      <Link to="/papers" className={homeworkActive ? 'active' : ''} aria-current={homeworkActive ? 'page' : undefined} aria-label="作业管理" title="作业管理">
        <NavIcon name="tasks" /><span>作业管理</span>
      </Link>
      <NavLink to="/" end aria-label="组卷" title="组卷"><NavIcon name="compose" /><span>组卷</span></NavLink>
      <div className="sidebar-class-section" ref={classSection} onBlur={(event) => {
        if (collapsed && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}>
        <div className={`sidebar-class-heading${pathname.startsWith('/classes') ? ' active' : ''}`}>
          <NavLink to="/classes" aria-label="我的班级" title="我的班级" onClick={() => setOpen(current => !current)}>
            <NavIcon name="classes" /><span>我的班级</span>
          </NavLink>
          <button ref={directoryToggle} type="button" className="class-directory-toggle" aria-label={open ? '收起我的班级' : '展开我的班级'}
            aria-expanded={open} aria-controls="sidebar-class-list" title={open ? '收起班级目录' : '展开班级目录'} onClick={() => setOpen(current => !current)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={open ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4'} /></svg>
          </button>
        </div>
        {open && (
          <ul className="sidebar-class-list" id="sidebar-class-list" aria-label="我的班级目录">
            {classes?.map((item) => (
              <li key={item.id}><NavLink to={`/classes/${item.id}`} onClick={() => collapsed && setOpen(false)}>
                <span className="class-directory-dot" aria-hidden="true" />{item.name}
              </NavLink></li>
            ))}
            {classes?.length === 0 && <li className="sidebar-class-hint">还没有班级</li>}
            {!classes && !error && <li className="sidebar-class-hint">正在加载班级…</li>}
            {error && <li className="sidebar-class-hint"><span role="alert">{error}</span><button type="button" onClick={() => setRetry((current) => current + 1)}>重试</button></li>}
          </ul>
        )}
      </div>
    </nav>
  );
}
