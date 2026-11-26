import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { AUTH_EXPIRED_EVENT, clearAuth, getAuth, saveAuth } from './api';
import AssignmentPage from './pages/AssignmentPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import ClassHomeworkPage from './pages/ClassHomeworkPage';
import ClassPage from './pages/ClassPage';
import StudentLearningPage from './pages/StudentLearningPage';
import CollectPage from './pages/CollectPage';
import ComposePage from './pages/ComposePage';
import HomeworkPage from './pages/HomeworkPage';
import ClassesPage from './pages/ClassesPage';
import LoginPage from './pages/LoginPage';
import PrintPage from './pages/PrintPage';
import ReportPage from './pages/ReportPage';
import ReviewPage from './pages/ReviewPage';
import RosterPage from './pages/RosterPage';
import type { TeacherAuth } from './types';
import SidebarNav from './components/SidebarNav';

const SIDEBAR_KEY = 'openphysics:teacher:sidebar-collapsed';

function initialSidebarCollapsed(): boolean {
  try {
    const saved = window.localStorage.getItem(SIDEBAR_KEY);
    if (saved === 'true' || saved === 'false') return saved === 'true';
  } catch { /* This preference also works for the current session without storage. */ }
  return window.matchMedia?.('(max-width: 1250px)')?.matches ?? false;
}

/** Account actions stay at the foot of the navigation. */
function AccountMenu({ name, ready, onSignOut }: { name: string; ready: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="account" ref={box}>
      <button type="button" className="account-button" aria-haspopup="true" aria-expanded={open}
        aria-label={`${name} ▾`} onClick={() => setOpen(!open)}>
        <span className="account-avatar" aria-hidden="true">{name.slice(0, 1)}</span>
        <span className="account-name">{name}</span><span className="account-chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="account-menu" role="menu" aria-label="账户">
          {ready && <Link role="menuitem" to="/password" onClick={() => setOpen(false)}>修改密码</Link>}
          <button role="menuitem" type="button" onClick={onSignOut}>退出</button>
        </div>
      )}
    </div>
  );
}

/** The old address of the personalized homework form: now a mode of 组卷. */
function PersonalizedRedirect() {
  const [params] = useSearchParams();
  const forClass = params.get('for');
  return <Navigate to={`/?mode=personalized${forClass ? `&for=${encodeURIComponent(forClass)}` : ''}`} replace />;
}

export default function App() {
  const [auth, setAuth] = useState<TeacherAuth | null>(() => getAuth());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_KEY, String(next)); } catch { /* Keep the session preference. */ }
  }

  const signIn = useCallback((next: TeacherAuth) => {
    saveAuth(next);
    setAuth(next);
  }, []);

  const signOut = useCallback(() => {
    clearAuth();
    setAuth(null);
  }, []);

  useEffect(() => {
    const expire = () => setAuth(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expire);
  }, []);

  // Only the isolated PDF renderer injects this already-authorized snapshot.
  // This branch makes no API requests and grants no access to teacher data.
  if (window.__OPENPHYSICS_PRINT__) return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <main className="page"><PrintPage snapshot={window.__OPENPHYSICS_PRINT__} /></main>
    </BrowserRouter>
  );

  if (!auth) return <LoginPage onSignedIn={signIn} />;

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <div className={`teacher-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <aside className="app-sidebar no-print" id="teacher-sidebar" aria-label="教师工作台">
          <button type="button" className="sidebar-toggle" onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? '展开导航' : '收起导航'} title={sidebarCollapsed ? '展开导航' : '收起导航'}
            aria-expanded={!sidebarCollapsed} aria-controls="teacher-sidebar">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d={sidebarCollapsed ? 'm7 5 5 5-5 5' : 'm12 5-5 5 5 5'} />
            </svg>
          </button>
          <Link to="/" className="sidebar-brand" aria-label="OpenPhysics · 教师端">
            <img className="brand-icon" src={`${import.meta.env.BASE_URL}brand-icon.png`} alt="" aria-hidden="true" />
            <span className="brand-name">OpenPhysics</span>
          </Link>
          {!auth.teacher.must_change_password && <SidebarNav collapsed={sidebarCollapsed} />}
          <div className="sidebar-account">
            <AccountMenu name={auth.teacher.display_name} ready={!auth.teacher.must_change_password} onSignOut={signOut} />
          </div>
        </aside>
        <main className="page teacher-main">
          {auth.teacher.must_change_password ? (
            <ChangePasswordPage forced onChanged={signIn} />
          ) : (
            <Routes>
              <Route path="/" element={<ComposePage />} />
              <Route path="/papers" element={<HomeworkPage />} />
              <Route path="/classes" element={<ClassesPage />} />
              <Route path="/classes/:classId" element={<ClassPage />} />
              <Route path="/classes/:classId/assignments" element={<ClassHomeworkPage />} />
              <Route path="/classes/:classId/students/:studentId" element={<StudentLearningPage />} />
              <Route path="/classes/:classId/roster" element={<RosterPage />} />
              <Route path="/personalized/new" element={<PersonalizedRedirect />} />
              <Route path="/assignments/:assignmentId" element={<AssignmentPage />} />
              <Route path="/assignments/:assignmentId/print" element={<PrintPage />} />
              <Route path="/assignments/:assignmentId/collect" element={<CollectPage />} />
              <Route path="/assignments/:assignmentId/review" element={<ReviewPage />} />
              <Route path="/assignments/:assignmentId/report" element={<ReportPage />} />
              <Route path="/password" element={<ChangePasswordPage onChanged={signIn} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </main>
      </div>
    </BrowserRouter>
  );
}
