import { Suspense, useEffect, useRef, useState } from 'react';
import { createBrowserRouter, RouterProvider, Routes, Route, Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import PracticeExitGuard, { usePracticeExit } from './components/PracticeExitGuard';
import { api } from './api/client';
import { clearStudentSession, getStudentProfile, getStudentToken, setStudentProfile, STUDENT_ACCESS_REFRESH_EVENT } from './api/studentIdentity';
import { AndroidAppDownloadMenu } from './components/AndroidAppDownload';
import StudentAccountMenu from './components/StudentAccountMenu';
import {
  loadSyncPage,
  preloadPrimaryStudentRoutes,
  preloadReviewPage,
  preloadSyncPage,
  preloadTrainPage,
} from './utils/routePreload';
import { isCapacitorShell, shouldHideStudentWebNav } from './utils/capacitorShell';
import { lazyRoute } from './utils/lazyRoute';
import { hasLearningAccess } from './utils/learningAccess';
import { legalOperatorName } from './content/legalDocuments';
import {PRACTICE_SAVE_ERROR, PRACTICE_SAVE_WARNING, hasPracticeSaveError} from './utils/practicePersistence';

const DirectoryPage = lazyRoute(() => import('./pages/DirectoryPage'));
const SyncPage = lazyRoute(loadSyncPage);
const HomePage = lazyRoute(() => import('./pages/HomePage'));
const TrainPage = lazyRoute(() => import('./pages/TrainPage'));
const GaokaoReviewPage = lazyRoute(() => import('./pages/GaokaoReviewPage'));
const TeacherHomeworkPage = lazyRoute(() => import('./pages/TeacherHomeworkPage'));
const HomeworkHistoryPage = lazyRoute(() => import('./pages/HomeworkHistoryPage'));
const ReviewPage = lazyRoute(() => import('./pages/ReviewPage'));
const HistoryPage = lazyRoute(() => import('./pages/HistoryPage'));
const LearnPage = lazyRoute(() => import('./pages/LearnPage'));
const KpCheckPage = lazyRoute(() => import('./pages/KpCheckPage'));
const LoginPage = lazyRoute(() => import('./pages/LoginPage'));
const AccountSecurityPage = lazyRoute(() => import('./pages/AccountSecurityPage'));
const PersonalCenterPage = lazyRoute(() => import('./pages/PersonalCenterPage'));
const PrivacyPolicyPage = lazyRoute(() => import('./pages/PrivacyPolicyPage'));
const TermsPage = lazyRoute(() => import('./pages/TermsPage'));
const MinorsPolicyPage = lazyRoute(() => import('./pages/MinorsPolicyPage'));
const QuestionPanePage = lazyRoute(() => import('./pages/QuestionPanePage'));


function ProtectedRoute({ children }: { children: JSX.Element }) {
  const location = useLocation();
  if (!getStudentToken()) {
    return <Navigate to={'/login'} replace state={{ from: location }} />;
  }
  return children;
}

function RouteLoading() {
  return <div className="loading">加载中...</div>;
}

function QuestionPaneRouteLoading() {
  return (
    <main className="android-question-pane android-question-pane-state" data-testid="android-question-pane-loading">
      <div className="android-question-pane-skeleton" />
      <div className="android-question-pane-skeleton short" />
      <div className="android-question-pane-loading-copy">题目加载中...</div>
    </main>
  );
}

function Shell() {
  const location = useLocation();

  if (location.pathname === '/question-pane') {
    return (
      <Suspense fallback={<QuestionPaneRouteLoading />}>
        <Routes>
          <Route path="/question-pane" element={<QuestionPanePage />} />
          <Route path="*" element={<QuestionPanePage />} />
        </Routes>
      </Suspense>
    );
  }

  return <StudentShell location={location} />;
}

function StudentShell({ location }: { location: ReturnType<typeof useLocation> }) {
  const icpFiling = import.meta.env.VITE_ICP_FILING?.trim();
  const [, setSessionVersion] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveWarning, setSaveWarning] = useState(hasPracticeSaveError);
  const capacitorAccountMenuRef = useRef<HTMLDetailsElement>(null);
  const navigate = useNavigate();
  const studentToken=getStudentToken();
  const isAuthenticated = Boolean(studentToken);
  const profile = isAuthenticated ? getStudentProfile() : null;
  const canUseLearning = isAuthenticated && hasLearningAccess(profile);
  const isLearningActive = location.pathname === '/sync' || location.pathname.startsWith('/learn');
  const hideWebNav = shouldHideStudentWebNav(location.pathname);
  const showCapacitorHomeAccount = hideWebNav && location.pathname === '/' && profile;
  const showAppDownload = !isCapacitorShell();
  const navbarClassName = ['navbar', !isAuthenticated ? 'is-public' : '', menuOpen ? 'menu-open' : '']
    .filter(Boolean)
    .join(' ');

  const requestExit = usePracticeExit();
  const handleLogout = () => requestExit(() => {
    clearStudentSession();
    setSessionVersion(version => version + 1);
    navigate('/login', { replace: true });
  });

  const closeMenu = () => {
    setMenuOpen(false);
  };

  useEffect(()=>{
    const changed=()=>setSessionVersion(version=>version+1);
    window.addEventListener('storage',changed);
    window.addEventListener('openphysics:student-session-changed',changed);
    return()=>{
      window.removeEventListener('storage',changed);
      window.removeEventListener('openphysics:student-session-changed',changed);
    };
  },[]);

  useEffect(() => {
    const failed = () => setSaveWarning(true);
    window.addEventListener(PRACTICE_SAVE_ERROR, failed);
    if (hasPracticeSaveError()) setSaveWarning(true);
    return () => window.removeEventListener(PRACTICE_SAVE_ERROR, failed);
  }, []);

  useEffect(() => {
    if (isAuthenticated) preloadPrimaryStudentRoutes();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    let refreshInFlight = false;

    const refreshStudent = () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      void api.getCurrentStudent()
        .then(student => {
          if (cancelled || getStudentToken()!==studentToken) return;
          if (JSON.stringify(getStudentProfile()) === JSON.stringify(student)) return;
          setStudentProfile(student);
          setSessionVersion(version => version + 1);
        })
        .catch(() => {
          if (!cancelled && !getStudentToken()) {
            setSessionVersion(version => version + 1);
          }
        })
        .finally(() => {
          refreshInFlight = false;
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshStudent();
    };

    refreshStudent();
    window.addEventListener('focus', refreshStudent);
    window.addEventListener(STUDENT_ACCESS_REFRESH_EVENT, refreshStudent);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshStudent);
      window.removeEventListener(STUDENT_ACCESS_REFRESH_EVENT, refreshStudent);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [isAuthenticated,studentToken]);


  useEffect(() => {
    if (!showCapacitorHomeAccount) return;

    const closeAccountMenu = (event: PointerEvent) => {
      const menu = capacitorAccountMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) {
        menu.removeAttribute('open');
      }
    };
    const closeAccountMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        capacitorAccountMenuRef.current?.removeAttribute('open');
      }
    };

    document.addEventListener('pointerdown', closeAccountMenu);
    document.addEventListener('keydown', closeAccountMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeAccountMenu);
      document.removeEventListener('keydown', closeAccountMenuOnEscape);
    };
  }, [showCapacitorHomeAccount]);

  const shellClassName = [
    'student-app-shell',
    hideWebNav ? 'is-capacitor-learning-shell' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={shellClassName}>
      {saveWarning && <div className="error-banner" role="alert">{PRACTICE_SAVE_WARNING}</div>}
      {showCapacitorHomeAccount && (
        <details className="capacitor-account-menu" ref={capacitorAccountMenuRef}>
          <summary className="capacitor-account-trigger">账户</summary>
          <div className="capacitor-account-popover">
            <div className="capacitor-account-identity">
              <span className="capacitor-account-label">当前账户</span>
              <strong className="capacitor-account-name">
                {profile.display_name || profile.username}
              </strong>
            </div>
            <Link to="/account-security">账号安全</Link>
            <button
              type="button"
              className="capacitor-account-logout"
              onClick={handleLogout}
            >
              退出登录
            </button>
          </div>
        </details>
      )}

      {!hideWebNav && (
        <nav className={navbarClassName}>
          <NavLink to="/" className="navbar-brand" onClick={closeMenu}>
            <span>Open</span>Physics
          </NavLink>
          {isAuthenticated ? (
            <>
              <button type="button" className="hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="菜单">
                {menuOpen ? '✕' : '☰'}
              </button>
              <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''} onClick={closeMenu}>
                首页
              </NavLink>
              <NavLink
                to="/sync"
                className={() => isLearningActive ? 'active' : ''}
                onClick={closeMenu}
                onFocus={preloadSyncPage}
                onMouseEnter={preloadSyncPage}
                onTouchStart={preloadSyncPage}
              >
                同步学习
              </NavLink>
              <NavLink
                to="/train"
                className={({ isActive }) => isActive ? 'active' : ''}
                onClick={closeMenu}
                onFocus={preloadTrainPage}
                onMouseEnter={preloadTrainPage}
                onTouchStart={preloadTrainPage}
              >
                巩固提升
              </NavLink>
              <NavLink
                to="/gaokao"
                className={({ isActive }) => isActive ? 'active' : ''}
                onClick={closeMenu}
              >
                高考复习
              </NavLink>
              <NavLink
                to="/review"
                className={({ isActive }) => isActive ? 'active' : ''}
                onClick={closeMenu}
                onFocus={preloadReviewPage}
                onMouseEnter={preloadReviewPage}
                onTouchStart={preloadReviewPage}
              >
                错题本
              </NavLink>
              <div className="navbar-actions">
                {showAppDownload ? (
                  <AndroidAppDownloadMenu />
                ) : null}
                {profile && (
                  <StudentAccountMenu key={studentToken} name={profile.display_name || profile.username}
                    onLogout={handleLogout} onNavigate={closeMenu} />
                )}
              </div>
            </>
          ) : (
            <>
              {showAppDownload ? (
                <AndroidAppDownloadMenu />
              ) : null}
              <NavLink
                to="/login"
                className={({ isActive }) => `navbar-login-pill${isActive ? ' active' : ''}`}
                onClick={closeMenu}
              >
                登录
              </NavLink>
            </>
          )}
        </nav>
      )}

      <Suspense key={studentToken || 'public'} fallback={<RouteLoading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<Navigate replace to="/login" />} />
          <Route path="/profile" element={<ProtectedRoute><PersonalCenterPage /></ProtectedRoute>} />
          <Route path="/account-security/reset" element={<AccountSecurityPage key="reset" mode="reset" />} />
          <Route path="/account-security" element={<ProtectedRoute><AccountSecurityPage key="credentials" /></ProtectedRoute>} />


          <Route path="/legal/terms" element={<TermsPage />} />
          <Route path="/legal/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/legal/minors" element={<MinorsPolicyPage />} />
          <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
          <Route path="/sync" element={<ProtectedRoute><SyncPage /></ProtectedRoute>} />
          <Route path="/directory" element={<ProtectedRoute><DirectoryPage /></ProtectedRoute>} />
          <Route path="/learn" element={<ProtectedRoute><LearnPage /></ProtectedRoute>} />
          <Route path="/learn/check" element={<ProtectedRoute><KpCheckPage /></ProtectedRoute>} />
          <Route path="/train" element={<ProtectedRoute><TrainPage /></ProtectedRoute>} />
          <Route path="/gaokao" element={<ProtectedRoute><GaokaoReviewPage /></ProtectedRoute>} />
          <Route path="/homework" element={<ProtectedRoute><HomeworkHistoryPage /></ProtectedRoute>} />
          <Route path="/homework/:attemptId" element={<ProtectedRoute><TeacherHomeworkPage /></ProtectedRoute>} />
          <Route path="/review/*" element={<ProtectedRoute><ReviewPage /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><HistoryPage /></ProtectedRoute>} />
          <Route path="/question-pane" element={<QuestionPanePage />} />
          <Route path="*" element={<Navigate to={canUseLearning ? '/' : '/login'} replace />} />
        </Routes>
      </Suspense>
      {!hideWebNav && (
        <footer className="site-footer no-print" aria-label="网站备案信息">
          <div className="site-footer-inner">
            <nav className="site-footer-legal" aria-label="法律文件">
              <Link to="/legal/terms">用户协议</Link>
              <Link to="/legal/privacy">隐私政策</Link>
              <Link to="/legal/minors">未成年人保护</Link>
            </nav>
            <div className="site-footer-records">
              <span>经营主体：{legalOperatorName}</span>
              <a href="https://www.gsxt.gov.cn/index.html" target="_blank" rel="noreferrer">
                营业执照信息查询
              </a>
              {icpFiling ? <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
                {icpFiling}
              </a> : null}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

export default function App() {
  const [router, setRouter] = useState<ReturnType<typeof createBrowserRouter>>();
  useEffect(() => {
    const next = createBrowserRouter([{ path: '*', element:
      <PracticeExitGuard sessionAvailable={() => !!getStudentToken()}><Shell /></PracticeExitGuard>,
    }]);
    setRouter(next);
    return () => next.dispose();
  }, []);
  return router ? <RouterProvider router={router} /> : <RouteLoading />;
}
