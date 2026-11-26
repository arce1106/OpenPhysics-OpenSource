import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { TeacherAuth } from '../types';

export default function LoginPage({ onSignedIn }: { onSignedIn: (auth: TeacherAuth) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      onSignedIn(await api.login(username.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>OpenPhysics · 教师端</h1>
        <p className="muted">使用管理员为你开通的教师账号登录。</p>
        <label htmlFor="teacher-username">用户名</label>
        <input
          id="teacher-username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
        <label htmlFor="teacher-password">密码</label>
        <input
          id="teacher-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? '正在登录…' : '登录'}
        </button>
      </form>
    </main>
  );
}
