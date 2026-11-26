import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { clearStudentSession, getStudentProfile, getStudentToken, setStudentSession } from '../api/studentIdentity';
import type { AccountCredentialsSettings, StudentLoginResponse } from '../types';
import AccountSecurityEditor, { type SecurityEditor, type SecurityMutation } from './AccountSecurityEditor';
import StudentClasses from './StudentClasses';
import './PersonalCenterPage.css';

type UpdateResponse = StudentLoginResponse & { changed: boolean; settings: AccountCredentialsSettings };
function initialEditor(value: unknown): SecurityEditor | null {
  return value === 'username' || value === 'password' ? value : null;
}

export default function PersonalCenterPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AccountCredentialsSettings | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<SecurityEditor | null>(() => initialEditor(location.state?.editor));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState(false);
  const [classBusy, setClassBusy] = useState(false);
  const securityNotice = location.state?.securityNotice || '';
  const [notice, setNotice] = useState<string>(securityNotice);
  const mounted = useRef(true);
  const lock = useRef(false);
  const triggers = useRef<Partial<Record<SecurityEditor, HTMLButtonElement | null>>>({});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    // Router transitions may finish after session renewal remounts this page.
    if (securityNotice) {
      setNotice(securityNotice);
      setEditor(null);
      setDirty(false);
    }
  }, [securityNotice]);
  useEffect(() => {
    let active = true;
    const token = getStudentToken();
    setError(false);
    api.getAccountCredentials().then(value => {
      if (active && getStudentToken() === token) setSettings(value);
    }).catch(() => { if (active && getStudentToken() === token) setError(true); });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    if (!dirty && !busy && !activity && !classBusy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy, activity, classBusy]);
  function selectEditor(next: SecurityEditor | null) {
    if (lock.current || activity || classBusy) return;
    if (dirty && !window.confirm('有尚未保存的内容，确定放弃吗？')) return;
    if (!next && editor) triggers.current[editor]?.focus();
    setEditor(next); setDirty(false); setNotice('');
  }
  async function save(path: SecurityMutation, payload: Record<string, string | boolean>, message: string) {
    if (lock.current || classBusy) return;
    const token = getStudentToken();
    const identity = getStudentProfile()?.id;
    lock.current = true; setBusy(true);
    try {
      const result = await api.securityRequest<UpdateResponse>(path, payload);
      if (!mounted.current || getStudentToken() !== token) return;
      if (!result.changed || !identity || typeof result.access_token !== 'string' || !result.access_token || result.access_token === token || result.student?.id !== identity || !result.settings) {
        throw new Error('登录状态未能续接');
      }
      const success = message + '，当前登录已更新。';
      setEditor(null); setDirty(false); setSettings(result.settings); setNotice(success);
      // The shell remounts authenticated routes on token changes. Carry only a
      // non-sensitive notice, never passwords or verification proofs.
      navigate('/profile', { replace: true, state: { securityNotice: success } });
      setStudentSession(result.access_token, result.student);
    } catch (failure) {
      if (!mounted.current || getStudentToken() !== token) return;
      const status = (failure as Error & { status?: number }).status;
      if (status && status >= 400 && status < 500) throw failure;
      // A lost response is not evidence that the write failed. Never retry it
      // automatically or retain a possibly revoked session.
      clearStudentSession();
      navigate('/login', { replace: true, state: { securityNotice: '无法确认保存后的登录状态，请重新登录后核对设置。' } });
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const rows: { key: SecurityEditor; title: string; value: string; action: string; label: string }[] = settings ? [
    { key: 'username', title: '用户名', value: settings.username, action: '修改', label: '修改用户名' },
    { key: 'password', title: '登录密码', value: settings.has_password ? '已设置' : '未设置', action: settings.has_password ? '修改' : '设置', label: settings.has_password ? '修改密码' : '设置密码' },

  ] : [];
  return <main className="personal-center-page"><section className="personal-center-card">
    <h1>个人中心</h1>
    {notice && <p role="status" className="security-success">{notice}</p>}
    {error ? <div role="alert"><p>暂时无法读取账号设置，请重试。</p><button type="button" onClick={() => setReload(value => value + 1)}>重新加载</button></div>
      : !settings ? <p role="status">正在读取账号设置…</p> : <ul className="personal-center-settings">
        {rows.map(row => <li key={row.key}>
          <div className="personal-center-row"><div><span>{row.title}</span><p title={row.value}>{row.value}</p></div>
            <button type="button" ref={node => { triggers.current[row.key] = node; }} aria-label={row.label} aria-expanded={editor === row.key} aria-controls={'security-editor-' + row.key} disabled={busy || activity || classBusy}
              onClick={() => selectEditor(editor === row.key ? null : row.key)}>{editor === row.key ? '收起' : row.action}</button>
          </div>
          {editor === row.key && <AccountSecurityEditor key={row.key} kind={row.key} settings={settings} busy={busy || classBusy} onDirty={setDirty} onActivity={setActivity} onCancel={() => selectEditor(null)} onSave={save} />}
        </li>)}
      </ul>}
    <StudentClasses disabled={busy || activity || dirty} onBusy={setClassBusy} />
    <Link className="personal-center-back" to="/" onClick={event => { if (busy || activity || classBusy || (dirty && !window.confirm('有尚未保存的内容，确定离开吗？'))) event.preventDefault(); }}>返回首页</Link>
  </section></main>;
}
