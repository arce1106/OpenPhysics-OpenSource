import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { getStudentToken } from '../api/studentIdentity';
import { isCapacitorShell } from '../utils/capacitorShell';
import './LoginPage.css';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captcha, setCaptcha] = useState<{ challenge_id: string; image_base64: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: { pathname: string }; securityNotice?: string } | null);
  const loadCaptcha = useCallback(async () => {
    const current = ++generation.current;
    setCaptchaLoading(true); setCaptcha(null); setCaptchaAnswer('');
    try {
      const result = await api.getCaptcha();
      if (current === generation.current) setCaptcha(result);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : '图形验证码加载失败');
    } finally { if (current === generation.current) setCaptchaLoading(false); }
  }, []);
  useEffect(() => {
    if (captchaRequired) void loadCaptcha();
    return () => { generation.current++; };
  }, [captchaRequired, loadCaptcha]);
  if (getStudentToken()) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || !username.trim() || !password || (captchaRequired && (!captcha || !captchaAnswer.trim()))) return;
    busy.current = true; setLoading(true); setError('');
    try {
      await api.login(username.trim(), password, captchaRequired && captcha
        ? { captcha_id: captcha.challenge_id, captcha_answer: captchaAnswer.trim() } : undefined);
      navigate(isCapacitorShell() ? '/' : from?.from?.pathname || '/', { replace: true });
    } catch (cause) {
      const problem = cause as Error & { captchaRequired?: boolean };
      if (problem.captchaRequired) setCaptchaRequired(true);
      if (captchaRequired) await loadCaptcha();
      setError(problem.message || '登录失败，请重试');
    } finally { busy.current = false; setLoading(false); }
  };
  const disabled = loading || !username.trim() || !password || (captchaRequired && (!captcha || !captchaAnswer.trim()));
  return <div style={{ minHeight: 'calc(100vh - 54px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#f6f8fa' }}>
    <form onSubmit={submit} aria-label="账号密码登录" className="card auth-card" style={{ width: '100%', maxWidth: 480, padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>学生登录</h1>
      <fieldset className="registration-fields" disabled={loading}>
        <div className="registration-field-row"><label className="registration-field-label" htmlFor="login-account">账号</label><input id="login-account" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /></div>
        <div className="registration-field-row"><label className="registration-field-label" htmlFor="login-password">密码</label><input id="login-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></div>
      </fieldset>
      {captchaRequired && <div style={{ marginTop: 16 }}>
        <label htmlFor="login-captcha">图形验证码</label>
        {captcha && <img src={captcha.image_base64} alt="图形验证码" />}
        <button type="button" disabled={captchaLoading || loading} onClick={() => void loadCaptcha()}>{captchaLoading ? '加载中...' : '换一张'}</button>
        <input id="login-captcha" autoComplete="off" value={captchaAnswer} onChange={e => setCaptchaAnswer(e.target.value)} />
      </div>}
      {error && <div className="error-banner" role="alert" style={{ marginTop: 16 }}>{error}</div>}
      {from?.securityNotice && <p role="status">{from.securityNotice}</p>}
      <div className="auth-actions"><button type="submit" className="auth-submit-button" disabled={disabled} aria-describedby="auth-legal-notice">{loading ? '登录中...' : '登录'}</button></div>
      <p className="auth-legal-notice">账号开通或忘记密码，请联系本部署的管理员。登录后可在个人中心修改账号和密码。</p>
      <div id="auth-legal-notice" className="auth-legal-notice">登录即表示同意<Link to="/legal/terms">《用户协议》</Link>、<Link to="/legal/privacy">《隐私政策》</Link>和<Link to="/legal/minors">《未成年人保护规则》</Link>。</div>
    </form>
  </div>;
}
