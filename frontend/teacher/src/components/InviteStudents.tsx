import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ClassInvitation } from '../types';
import Modal from './Modal';

export default function InviteStudents({ classId, className }: { classId: string; className: string }) {
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState<ClassInvitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = closeButton.current?.closest('[role="dialog"]');
    if (open && !busy && dialog && !dialog.contains(document.activeElement)) closeButton.current?.focus();
  }, [open, busy]);
  async function run(action: () => Promise<ClassInvitation>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { setInvite(await action()); }
    catch (err) { setError(err instanceof Error ? err.message : '操作失败，请重试'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <button type="button" onClick={() => { setOpen(true); setInvite(null); void run(() => api.classInvitation(classId)); }}>邀请学生</button>
    {open && <Modal label="邀请学生" className="class-invite-dialog" onClose={() => { if (!busy) setOpen(false); }}>
      <div className="class-invite-head">
        <h2>邀请学生加入 {className}</h2>
        <button ref={closeButton} className="class-invite-close" type="button" aria-label="关闭" title="关闭" disabled={busy} onClick={() => setOpen(false)}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
        </button>
      </div>
      {error && <p role="alert" className="class-invite-feedback error">{error}</p>}
      {busy && <p role="status" className="class-invite-feedback">正在处理…</p>}
      {invite?.enabled && invite.code ? <>
        <div className="class-invite-code-box">
          <p className="class-invite-code" aria-label="班级邀请码">{invite.code}</p>
          <button type="button" className="class-invite-copy" aria-label="复制邀请码" disabled={busy} onClick={async () => {
            try { await navigator.clipboard.writeText(invite.code!); setNotice('已复制'); }
            catch { setError('复制失败，请选中邀请码手动复制'); }
          }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="7" y="6" width="9" height="11" rx="2" /><path d="M12 6V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" /></svg>
            <span role="status">{notice || '复制邀请码'}</span>
          </button>
        </div>
        <p className="class-invite-help">
          {invite.expires_at && <>有效期至 {new Date(invite.expires_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}。</>}
          学生在网页或 App 的“个人中心 → 我的班级 → 加入班级”输入邀请码；新同学也可以在注册时直接填写，注册即入班。入班时须填写真实姓名，并查看共享说明。
        </p>
        <p className="class-invite-help muted">重新生成后旧码立即失效；被移出的学生可以用新码重新加入。</p>
      </> : invite && <p className="class-invite-empty">当前未开放邀请。</p>}
      <div className={`class-invite-actions${invite?.enabled ? '' : ' class-invite-actions-single'}`} key="invite-actions">
        <button type="button" className={invite?.enabled ? 'class-invite-regenerate' : 'class-invite-generate'} disabled={busy || !invite} onClick={() => run(() => api.generateClassInvitation(classId))}>{invite?.enabled ? '重新生成邀请码' : '生成邀请码'}</button>
        {invite?.enabled && <button type="button" className="class-invite-stop" disabled={busy} onClick={() => run(() => api.disableClassInvitation(classId))}>停止邀请</button>}
        {!invite && !busy && <button type="button" onClick={() => run(() => api.classInvitation(classId))}>重试</button>}
      </div>
    </Modal>}
  </>;
}
