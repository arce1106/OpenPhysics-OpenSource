import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, NavLink, Navigate, useLocation } from 'react-router-dom';
import PageErrorBoundary from './components/PageErrorBoundary';
import { ADMIN_AUTH_EXPIRED_EVENT, api, clearAdminToken, getAdminToken, setAdminToken } from './api/client';
import type { KpWithStats } from './types';
import { VOLUME_ORDER } from './common/labels';

const StudentsPage = lazy(() => import('./components/StudentsPage'));
const TeachersPage = lazy(() => import('./components/TeachersPage'));
const TeachingDashboardPage = lazy(() => import('./components/TeachingDashboardPage'));
const AdminHomePage = lazy(() => import('./components/AdminHomePage'));
const TeachingResourcesPage = lazy(() => import('./components/TeachingResourcesPage'));

// ── Design: Physics Lab Notebook ───────────────────────────────────────────

const TOPBAR_BG = '#1a1d23';
const ACCENT = '#0d7377';
const ACCENT_LIGHT = '#14919b';
const ALL_QUESTIONS_ID = '__all_questions__';

function firstVolume(kps: KpWithStats[]): string | null {
  const volumes = Array.from(new Set(kps.map(kp => kp.volume).filter(Boolean) as string[]));
  volumes.sort((a, b) => (VOLUME_ORDER[a] || 99) - (VOLUME_ORDER[b] || 99));
  return volumes[0] || null;
}

/** 切换页面时重置出错状态，一个页面出错不影响其他页面。 */
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return <PageErrorBoundary key={location.pathname}>{children}</PageErrorBoundary>;
}

// ── Top Navigation ─────────────────────────────────────────────────────────

function TopNav({
  username,
  onLogout,
}: {
  username: string;
  onLogout: () => void;
}) {
  const navItems = [
    { to: '/', label: '首页', end: true },
    { to: '/resources', label: '教学资源' },
    { to: '/teaching', label: '教学工作台' },
    { to: '/students', label: '学生管理' },
    { to: '/teachers', label: '教师与班级' },
  ];

  return (
    <header style={{
      height: 56,
      minHeight: 56,
      background: TOPBAR_BG,
      borderBottom: '1px solid #2a2d35',
      display: 'flex',
      alignItems: 'center',
      padding: '0 18px',
      gap: 22,
      userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 190 }}>
        <Link to="/" style={{ fontSize: 16, fontWeight: 800, color: '#fff', textDecoration: 'none', letterSpacing: '0.5px' }}>
          <span style={{ color: ACCENT_LIGHT }}>Open</span>Physics
        </Link>
      </div>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            style={({ isActive }) => ({
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 34,
              padding: '0 14px',
              color: isActive ? '#fff' : '#c8ccd4',
              background: isActive ? `${ACCENT}33` : 'transparent',
              border: isActive ? `1px solid ${ACCENT_LIGHT}` : '1px solid transparent',
              borderRadius: 6,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: isActive ? 800 : 500,
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: '#858b97', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username}</span>
        <button
          onClick={onLogout}
          style={{
            border: '1px solid #343945',
            background: '#222733',
            color: '#c8ccd4',
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          退出
        </button>
      </div>
    </header>
  );
}

export function LoginPage({ onLogin }: { onLogin: (username: string, token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError('请输入管理员账号和密码');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const result = await api.loginAdmin(username.trim(), password);
      setAdminToken(result.access_token);
      onLogin(result.username, result.access_token);
    } catch (e: any) {
      setError(e.message || '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f4f1ea',
      color: '#1f2933',
    }}>
      <form onSubmit={handleSubmit} style={{
        width: 360,
        background: '#fffdf8',
        border: '1px solid #ded8ca',
        borderRadius: 8,
        padding: 24,
        boxShadow: '0 12px 32px rgba(40, 35, 26, 0.12)',
      }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            <span style={{ color: ACCENT_LIGHT }}>Open</span>Physics
          </div>
          <div style={{ color: '#667085', fontSize: 13, marginTop: 4 }}>管理端登录</div>
        </div>
        <label htmlFor="admin-username" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>账号</label>
        <input
          id="admin-username"
          value={username}
          onChange={event => setUsername(event.target.value)}
          autoComplete="username"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #d0d5dd', borderRadius: 6, marginBottom: 14, fontSize: 14 }}
        />
        <label htmlFor="admin-password" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>密码</label>
        <input
          id="admin-password"
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          autoComplete="current-password"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #d0d5dd', borderRadius: 6, marginBottom: 14, fontSize: 14 }}
        />
        {error && <div style={{ color: '#b42318', fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%',
            border: 0,
            borderRadius: 6,
            background: submitting ? '#8abdc1' : ACCENT,
            color: '#fff',
            padding: '10px 12px',
            fontSize: 14,
            fontWeight: 700,
            cursor: submitting ? 'default' : 'pointer',
          }}
        >
          {submitting ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [adminUsername, setAdminUsername] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [kps, setKps] = useState<KpWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedVolumeKey, setSelectedVolumeKey] = useState<string | null>(null);
  const [selectedKpId, setSelectedKpId] = useState<string | null>(null);
  const [selectedChapterKey, setSelectedChapterKey] = useState<string | null>(null);
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!getAdminToken()) {
        setCheckingAuth(false);
        return;
      }
      try {
        const me = await api.getAdminMe();
        setAdminUsername(me.username);
      } catch {
        clearAdminToken();
        setAdminUsername(null);
      } finally {
        setCheckingAuth(false);
      }
    })();
  }, []);

  useEffect(() => {
    const handleExpired = () => {
      setAdminUsername(null);
      setKps([]);
      setSelectedVolumeKey(null);
      setSelectedKpId(null);
      setSelectedChapterKey(null);
      setSelectedSectionKey(null);
    };
    window.addEventListener(ADMIN_AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(ADMIN_AUTH_EXPIRED_EVENT, handleExpired);
  }, []);

  useEffect(() => {
    if (!adminUsername) return;
    (async () => {
      try {
        setLoading(true);
        const kpsData = await api.listKnowledgePointsWithStats();
        setKps(kpsData);
        setSelectedVolumeKey(prev => prev || firstVolume(kpsData));
      } catch (e: any) {
        setError(e.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [adminUsername]);

  const handleSelectVolume = (vol: string) => {
    setSelectedVolumeKey(vol);
    setSelectedKpId(null);
    setSelectedChapterKey(null);
    setSelectedSectionKey(null);
  };

  const handleSelectKp = (id: string) => {
    setSelectedVolumeKey(null);
    setSelectedKpId(id);
    setSelectedChapterKey(null);
    setSelectedSectionKey(null);
  };

  const handleSelectChapter = (vol: string, ch: string) => {
    setSelectedVolumeKey(null);
    setSelectedChapterKey(`${vol}||${ch}`);
    setSelectedSectionKey(null);
    setSelectedKpId(null);
  };

  const handleSelectSection = (vol: string, ch: string, sec: string) => {
    setSelectedVolumeKey(null);
    setSelectedSectionKey(`${vol}||${ch}||${sec}`);
    setSelectedChapterKey(null);
    setSelectedKpId(null);
  };

  const handleLogout = () => {
    clearAdminToken();
    setAdminUsername(null);
    setKps([]);
    setSelectedVolumeKey(null);
  };

  if (checkingAuth) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#667085', background: '#f4f1ea' }}>
        检查登录状态...
      </div>
    );
  }

  if (!adminUsername) {
    return <LoginPage onLogin={(username) => setAdminUsername(username)} />;
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <TopNav
          username={adminUsername}
          onLogout={handleLogout}
        />
        <div style={{
          flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
          background: '#faf9f6',
          backgroundImage: `
            linear-gradient(rgba(0,0,0,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.025) 1px, transparent 1px)
          `,
          backgroundSize: '24px 24px',
        }}>
          <RouteErrorBoundary>
          <Suspense fallback={<div style={{ padding: 24, color: '#667085' }}>加载中...</div>}>
            <Routes>
              <Route path="/" element={<AdminHomePage kps={kps} />} />
              <Route path="/resources" element={
                <TeachingResourcesPage
                  kps={kps}
                  loading={loading}
                  error={error}
                  selectedVolumeKey={selectedVolumeKey}
                  onSelectVolume={handleSelectVolume}
                  selectedKpId={selectedKpId}
                  onSelectKp={handleSelectKp}
                  selectedChapterKey={selectedChapterKey}
                  onSelectChapter={handleSelectChapter}
                  selectedSectionKey={selectedSectionKey}
                  onSelectSection={handleSelectSection}
                  allQuestionsId={ALL_QUESTIONS_ID}
                />
              } />
              <Route path="/teaching" element={<TeachingDashboardPage kps={kps} onOpenKp={handleSelectKp} />} />
              <Route path="/students" element={<StudentsPage />} />
              <Route path="/teachers" element={<TeachersPage />} />
              <Route path="/quality" element={<Navigate to="/resources?tab=quality" replace />} />
              <Route path="/questions" element={<Navigate to="/resources?tab=questions" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          </RouteErrorBoundary>
        </div>
      </div>
    </BrowserRouter>
  );
}
