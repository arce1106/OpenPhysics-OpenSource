import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { getStudentProfile, getStudentToken, setStudentSession } from '../api/studentIdentity';
import type { StudentClass, StudentClassPreview } from '../types';

export default function StudentClasses({ disabled = false, onBusy }: { disabled?: boolean; onBusy: (busy: boolean) => void }) {
  // Joining while signing in with an invitation lands here with the result (router navigation state).
  const [classNotice] = useState<string | undefined>(() => {
    const state = window.history.state as { usr?: { classNotice?: string } } | null;
    return typeof state?.usr?.classNotice === 'string' ? state.usr.classNotice : undefined;
  });
  const [open, setOpen] = useState(Boolean(classNotice));
  const [renaming, setRenaming] = useState(false);
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [studentName, setStudentName] = useState('');
  const [preview, setPreview] = useState<StudentClassPreview | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(classNotice ?? '');
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (classNotice) void api.getMyClasses().then(items => { if (mounted.current) setClasses(items); }).catch(() => undefined);
  }, [classNotice]);
  async function run<T,>(action: () => Promise<T>, success: (result: T) => void) {
    if (lock.current || disabled) return;
    const token = getStudentToken();
    lock.current = true; setBusy(true); onBusy(true); setError(''); setNotice('');
    try {
      const result = await action();
      if (mounted.current && getStudentToken() === token) success(result);
    } catch (err) {
      if (mounted.current && getStudentToken() === token) setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally { lock.current = false; if (mounted.current) { setBusy(false); onBusy(false); } }
  }
  const leaveTarget = classes?.find(item => item.id === leaving);
  const name = studentName.trim();
  const validName = name.length > 0 && [...name].length <= 40 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name);
  return <section className="student-classes" aria-label="我的班级">
    <div className="personal-center-row"><div><span>我的班级</span></div>
      <button type="button" aria-expanded={open} aria-controls="my-classes" disabled={disabled || busy} onClick={() => {
        setOpen(!open); setLeaving(null); if (!open) void run(api.getMyClasses, setClasses);
      }}>{open ? '收起' : '管理'}</button></div>
    {open && <div id="my-classes" className="security-editor">
      {busy && <p role="status">正在处理…</p>}
      {error && <p role="alert" className="security-error">{error}</p>}
      {notice && <p role="status" className="security-success">{notice}</p>}
      {classes?.length === 0 && <p className="security-hint">你还没有加入班级。</p>}
      {classes && classes.length > 0 && <ul className="student-class-list">{classes.map(item => <li key={item.id}>
        <div><strong>{item.name}</strong><p>{[item.teacher_name, item.student_number ? `学号 ${item.student_number}` : null].filter(Boolean).join(' · ')}</p>
          {(item.archived || !item.teacher_active) && <p className="security-hint">{item.archived ? '班级已归档' : '老师账号已停用'}</p>}</div>
      </li>)}</ul>}
      <div className="security-actions student-class-actions"><button type="button" disabled={disabled || busy} onClick={() => { setAdding(!adding); setLeaving(null); setRenaming(false); setPreview(null); setError(''); setNotice(''); }}>加入班级</button>
        {classes && classes.length > 0 && <button type="button" disabled={disabled || busy} onClick={() => {
          setRenaming(!renaming); setAdding(false); setLeaving(null); setError(''); setNotice('');
          setStudentName(getStudentProfile()?.display_name ?? '');
        }}>修改姓名</button>}
        <button type="button" disabled={disabled || busy || !classes?.length} onClick={() => {
          setLeaving(classes?.length === 1 ? classes[0].id : ''); setAdding(false); setRenaming(false); setError(''); setNotice('');
        }}>退出班级</button></div>
      {adding && <form className="student-class-join" onSubmit={event => { event.preventDefault(); void run(() => api.previewClassInvitation(code), setPreview); }}>
        <div className="student-class-code-field"><label htmlFor="student-class-invitation-code">班级邀请码</label>
        <div className="student-class-code-row"><input id="student-class-invitation-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={8} placeholder="8 位邀请码" value={code} disabled={disabled || busy}
          onChange={event => { setCode(event.target.value.trim().toUpperCase()); setPreview(null); setError(''); }} />
          <button type="submit" disabled={disabled || busy || code.length !== 8}>查看班级</button></div></div>
        {preview && <div className="student-class-preview student-class-preview-with-name">
          <div className="student-class-preview-heading"><strong>{preview.name}</strong>
          {!preview.already_joined && <button type="button" className="security-save" disabled={disabled || busy || !validName} onClick={() => run(
            () => api.joinClass(code, preview.disclosure_version, name), result => {
              setClasses(items => [result, ...(items ?? []).filter(item => item.id !== result.id)]);
              setPreview(null); setAdding(false); setCode(''); setNotice(`已加入 ${result.name}，学号 ${result.student_number ?? '待分配'}。`);
              const profile = getStudentProfile();
              if (profile) setStudentSession(getStudentToken(), { ...profile, display_name: result.student_name });
            })}>同意并加入</button>}</div>
          <div className="student-class-preview-info"><span>{preview.teacher_name}</span></div>
          {!preview.already_joined && <p className="student-class-disclosure">{preview.disclosure}</p>}
          {preview.already_joined ? <p role="status">你已加入该班级。</p> :
          <div className="student-class-identity"><span>账号：{getStudentProfile()?.username}</span>
            <div className="student-class-name-row"><label htmlFor="student-class-name">学生姓名</label><input id="student-class-name" autoComplete="name" placeholder="填写真实姓名" maxLength={40} required value={studentName} disabled={disabled || busy} onChange={event => setStudentName(event.target.value)} /></div></div>}
        </div>}
      </form>}
      {renaming && <form className="student-class-rename" onSubmit={event => {
        event.preventDefault();
        if (!validName) return;
        void run(() => api.renameStudent(name), result => {
          setRenaming(false); setNotice(`老师看到的姓名已改为 ${result.student_name}。`);
          const profile = getStudentProfile();
          if (profile) setStudentSession(getStudentToken(), { ...profile, display_name: result.student_name });
        });
      }}>
        <label htmlFor="student-class-rename">学生姓名</label>
        <input id="student-class-rename" maxLength={40} required value={studentName} disabled={disabled || busy}
          onChange={event => setStudentName(event.target.value)} placeholder="填写真实姓名" />
        <button type="submit" className="security-save" disabled={disabled || busy || !validName}>保存</button>
        <p className="security-hint">所有班级的老师都会看到新的姓名。</p>
      </form>}
      {leaving !== null && <div className="student-class-exit">
        {classes && classes.length > 1 ? <label>选择班级<select value={leaving} disabled={disabled || busy} onChange={event => setLeaving(event.target.value)}>
          <option value="">请选择班级</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name} · {item.teacher_name}</option>)}
        </select></label> : <p>退出 {leaveTarget?.name}？</p>}
        <div className="security-actions"><button type="button" disabled={disabled || busy || !leaveTarget} onClick={() => {
          if (!leaveTarget) return;
          void run(() => api.leaveClass(leaveTarget.id), () => {
            setClasses(items => (items ?? []).filter(item => item.id !== leaveTarget.id)); setLeaving(null); setNotice(`已退出 ${leaveTarget.name}`);
          });
        }}>确认退出</button><button type="button" disabled={disabled || busy} onClick={() => setLeaving(null)}>取消</button></div>
      </div>}
    </div>}
  </section>;
}
