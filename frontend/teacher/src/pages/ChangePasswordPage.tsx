import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { TeacherAuth } from '../types';

export default function ChangePasswordPage({
  forced = false,
  onChanged,
}: {
  forced?: boolean;
  onChanged: (auth: TeacherAuth) => void;
}) {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (next !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      onChanged(await api.changePassword(current, next));
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败');
      setSubmitting(false);
    }
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>{forced ? '请先修改初始密码' : '修改密码'}</h1>
      {forced && <p className="muted">初始密码由管理员设置。修改后才能查看班级数据。</p>}
      <label htmlFor="current-password">当前密码</label>
      <input
        id="current-password"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
        required
      />
      <label htmlFor="new-password">新密码</label>
      <input
        id="new-password"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
        required
      />
      <p className="hint">至少 8 位，需同时包含字母和数字。</p>
      <label htmlFor="confirm-password">再次输入新密码</label>
      <input
        id="confirm-password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        required
      />
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={submitting}>
        {submitting ? '正在保存…' : '保存新密码'}
      </button>
    </form>
  );
}
