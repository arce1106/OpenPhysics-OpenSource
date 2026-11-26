import { type FormEvent, useEffect, useRef, useState } from 'react';
import { USERNAME_RULE_HINT, validUsername } from '../utils/usernamePolicy';
import type { AccountCredentialsSettings } from '../types';

export type SecurityEditor = 'username' | 'password';
export type SecurityMutation = 'account-credentials';
type Props = {
  kind: SecurityEditor; settings: AccountCredentialsSettings; busy: boolean;
  onDirty: (dirty: boolean) => void; onCancel: () => void;
  onActivity: (working: boolean) => void;
  onSave: (path: SecurityMutation, payload: Record<string, string | boolean>, notice: string) => Promise<void>;
};
export default function AccountSecurityEditor({ kind, settings, busy, onDirty, onCancel, onActivity, onSave }: Props) {
  const [username, setUsername] = useState(settings.username);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const locked = useRef(false);
  useEffect(() => { onDirty(kind === 'username' ? username !== settings.username : !!(currentPassword || password || confirmation)); }, [kind, username, settings.username, currentPassword, password, confirmation, onDirty]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || locked.current) return;
    if (kind === 'username' && !validUsername(username.trim())) { setError(USERNAME_RULE_HINT); return; }
    if (kind === 'password' && password !== confirmation) { setError('两次输入必须一致'); return; }
    if (kind === 'password' && (!currentPassword || password.trim().length < 6 || password.length > 128)) { setError('请填写原密码，新密码需为6—128位且两次输入一致'); return; }
    locked.current = true; onActivity(true); setError('');
    try {
      await onSave('account-credentials', kind === 'username' ? { username: username.trim(), renew_session: true }
        : { current_password: currentPassword, new_password: password, renew_session: true }, kind === 'username' ? '账号已修改' : '密码已修改');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试'); }
    finally { locked.current = false; onActivity(false); }
  };
  return <form id={'security-editor-' + kind} onSubmit={submit} className="security-editor" aria-label={kind === 'username' ? '修改账号' : '修改密码'}>
    {kind === 'username' ? <><label>新用户名<input autoFocus aria-label="新用户名" value={username} maxLength={32} disabled={busy} onChange={e => { setUsername(e.target.value); setError(''); }} /></label><p>{USERNAME_RULE_HINT}</p><p>还可修改{settings.username_changes_remaining}次{settings.username_next_change_at ? `，下次可修改：${settings.username_next_change_at}` : ""}</p></>
      : <><label>原密码<input autoFocus aria-label="原密码" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>
        <label>新密码<input aria-label="新密码" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>确认新密码<input aria-label="确认新密码" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label></>}
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={busy || (kind === 'username' && settings.username_changes_remaining === 0)}>保存</button><button type="button" disabled={busy} onClick={onCancel}>取消</button>
  </form>;
}
