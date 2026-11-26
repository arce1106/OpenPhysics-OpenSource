import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { api } from '../api/client';
import type { AdminClassMember, AdminTeacher, AdminTeacherClass, TeacherClassLevel } from '../types';
import ConfirmDialog from './ConfirmDialog';

const ACCENT = '#14919b';
const LEVEL_LABELS: Record<TeacherClassLevel, string> = {
  advanced: '实验班',
  standard: '普通班',
  foundation: '基础班',
};
const PASSWORD_HINT = '至少 8 位，需同时包含字母和数字';

type TeacherAction =
  | { kind: 'password'; teacher: AdminTeacher }
  | { kind: 'status'; teacher: AdminTeacher };

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toISOString().slice(0, 10);
}

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<AdminTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', display_name: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<TeacherAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const fetchTeachers = async () => {
    setLoading(true);
    setError(null);
    try {
      setTeachers(await api.listTeachers());
    } catch (e: any) {
      setError(e.message || '加载教师失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTeachers(); }, []);

  const replaceTeacher = (next: AdminTeacher) =>
    setTeachers(prev => prev.map(item => (item.id === next.id ? next : item)));

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.username.trim() || !form.display_name.trim() || !form.password) {
      setError('请填写用户名、姓名和初始密码');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.createTeacher({
        username: form.username.trim(),
        display_name: form.display_name.trim(),
        password: form.password,
      });
      setTeachers(prev => [...prev, created]);
      setForm({ username: '', display_name: '', password: '' });
      setNotice(`已创建教师 ${created.display_name}，首次登录需修改初始密码`);
    } catch (e: any) {
      setError(e.message || '创建教师失败');
    } finally {
      setSaving(false);
    }
  };

  const openAction = (next: TeacherAction) => {
    setNewPassword('');
    setActionError(null);
    setAction(next);
  };

  const confirmAction = async () => {
    if (!action) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (action.kind === 'password') {
        replaceTeacher(await api.resetTeacherPassword(action.teacher.id, newPassword));
        setNotice(`已重置 ${action.teacher.display_name} 的密码，下次登录需修改`);
      } else {
        const status = action.teacher.status === 'active' ? 'disabled' : 'active';
        replaceTeacher(await api.updateTeacher(action.teacher.id, { status }));
        setNotice(`已${status === 'active' ? '启用' : '停用'} ${action.teacher.display_name}`);
      }
      setAction(null);
    } catch (e: any) {
      setActionError(e.message || '操作失败');
    } finally {
      setActionBusy(false);
    }
  };

  const dialog = (() => {
    if (!action) return null;
    if (action.kind === 'password') {
      return {
        title: `重置 ${action.teacher.display_name} 的密码`,
        message: '重置后该教师已登录的设备会退出，下次登录需修改密码。',
        confirmLabel: '重置密码',
        confirmDisabled: !newPassword,
        body: (
          <label style={dialogLabel}>
            新的初始密码（{PASSWORD_HINT}）
            <input autoFocus type="password" autoComplete="new-password" value={newPassword}
              onChange={e => setNewPassword(e.target.value)} style={inputStyle} />
          </label>
        ),
      };
    }
    const disabling = action.teacher.status === 'active';
    return {
      title: `${disabling ? '停用' : '启用'} ${action.teacher.display_name}`,
      message: disabling ? '停用后该教师立即退出登录，不能再查看任何班级。' : '启用后该教师可以重新登录。',
      confirmLabel: disabling ? '停用' : '启用',
      tone: disabling ? 'danger' as const : 'default' as const,
      body: null,
    };
  })();

  return (
    <div style={{ padding: 24, overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1d23' }}>教师与班级</div>
          <div style={{ fontSize: 13, color: '#777', marginTop: 4 }}>
            创建教师账号，为教师建立班级，并把已有的学生账号加入班级。教师只能看到自己班级的学生。
          </div>
        </div>
        <button onClick={fetchTeachers} style={secondaryBtn}>刷新</button>
      </div>

      {error && <div style={errorBox}>{error}</div>}
      {notice && <div style={noticeBox}>{notice}</div>}

      {/* 新建教师账号的表单，不是管理员登录：关闭自动填充，避免填入管理员密码。 */}
      <form
        autoComplete="off"
        onSubmit={handleCreate}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr)) auto', gap: 8, marginBottom: 18 }}
      >
        <input aria-label="新教师用户名" name="new-teacher-username" autoComplete="off" placeholder="用户名"
          value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} style={inputStyle} />
        <input aria-label="新教师姓名" name="new-teacher-name" autoComplete="off" placeholder="姓名，如 王老师"
          value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} style={inputStyle} />
        <input aria-label="新教师初始密码" name="new-teacher-password" type="password" autoComplete="new-password"
          placeholder={`初始密码（${PASSWORD_HINT}）`} value={form.password}
          onChange={e => setForm({ ...form, password: e.target.value })} style={inputStyle} />
        <button type="submit" disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
          {saving ? '创建中...' : '创建教师'}
        </button>
      </form>

      {loading ? (
        <div style={{ color: '#8c8c8c' }}>正在加载...</div>
      ) : teachers.length === 0 ? (
        <div style={{ color: '#8c8c8c' }}>还没有教师账号。</div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {teachers.map(teacher => (
            <TeacherCard
              key={teacher.id}
              teacher={teacher}
              onChanged={replaceTeacher}
              onAction={openAction}
            />
          ))}
        </div>
      )}

      {dialog && (
        <ConfirmDialog
          open
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          tone={'tone' in dialog ? dialog.tone : 'default'}
          busy={actionBusy}
          confirmDisabled={'confirmDisabled' in dialog ? dialog.confirmDisabled : false}
          error={actionError}
          onConfirm={confirmAction}
          onCancel={() => setAction(null)}
        >
          {dialog.body}
        </ConfirmDialog>
      )}
    </div>
  );
}

function TeacherCard({
  teacher,
  onChanged,
  onAction,
}: {
  teacher: AdminTeacher;
  onChanged: (teacher: AdminTeacher) => void;
  onAction: (action: TeacherAction) => void;
}) {
  const [classForm, setClassForm] = useState({ name: '', grade: '', level: 'standard' as TeacherClassLevel });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openClassId, setOpenClassId] = useState<string | null>(null);

  const replaceClass = (next: AdminTeacherClass) => onChanged({
    ...teacher,
    classes: teacher.classes.map(item => (item.id === next.id ? next : item)),
  });

  const createClass = async (event: FormEvent) => {
    event.preventDefault();
    if (!classForm.name.trim()) {
      setError('请填写班级名称');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.createTeacherClass(teacher.id, {
        name: classForm.name.trim(),
        grade: classForm.grade.trim() || undefined,
        level: classForm.level,
      });
      onChanged({ ...teacher, classes: [...teacher.classes, created] });
      setClassForm({ name: '', grade: '', level: classForm.level });
    } catch (e: any) {
      setError(e.message || '创建班级失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = async (item: AdminTeacherClass) => {
    setError(null);
    try {
      replaceClass(await api.updateTeacherClass(item.id, { archived: !item.archived }));
    } catch (e: any) {
      setError(e.message || '操作失败');
    }
  };

  const active = teacher.status === 'active';
  return (
    <section aria-label={`教师 ${teacher.display_name}`} style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {teacher.display_name}
            <span style={{ fontSize: 13, fontWeight: 400, color: '#8c8c8c', marginLeft: 8 }}>{teacher.username}</span>
          </div>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4, display: 'flex', gap: 10 }}>
            <span style={{ color: active ? '#389e0d' : '#cf1322' }}>{active ? '启用' : '停用'}</span>
            {teacher.must_change_password && <span style={{ color: '#d48806' }}>待修改初始密码</span>}
            <span>最近登录 {formatDate(teacher.last_login_at)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={miniBtn} onClick={() => onAction({ kind: 'password', teacher })}>重置密码</button>
          <button style={active ? dangerMiniBtn : miniBtn} onClick={() => onAction({ kind: 'status', teacher })}>
            {active ? '停用' : '启用'}
          </button>
        </div>
      </div>

      {error && <div style={{ ...errorBox, marginTop: 10, marginBottom: 0 }}>{error}</div>}

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {teacher.classes.map(item => (
          <div key={item.id} style={{ border: '1px solid #f0f0f0', borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
              <strong style={{ fontSize: 14, color: item.archived ? '#8c8c8c' : '#1a1d23' }}>{item.name}</strong>
              <span style={{ fontSize: 12, color: '#8c8c8c', flex: 1 }}>
                {[item.grade, LEVEL_LABELS[item.level], `${item.member_count} 名学生`, item.archived ? '已归档' : null]
                  .filter(Boolean).join(' · ')}
              </span>
              <button style={miniBtn} onClick={() => setOpenClassId(openClassId === item.id ? null : item.id)}>
                {openClassId === item.id ? '收起' : '管理学生'}
              </button>
              <button style={miniBtn} onClick={() => toggleArchive(item)}>{item.archived ? '恢复' : '归档'}</button>
            </div>
            {openClassId === item.id && (
              <ClassMembers
                teacherClass={item}
                onCountChanged={count => replaceClass({ ...item, member_count: count })}
              />
            )}
          </div>
        ))}
      </div>

      <form
        autoComplete="off"
        onSubmit={createClass}
        style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: 8, marginTop: 10 }}
      >
        <input aria-label={`${teacher.display_name} 的新班级名称`} placeholder="新班级名称，如 高一(3)班"
          value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })} style={inputStyle} />
        <input aria-label={`${teacher.display_name} 的新班级年级`} placeholder="年级（可选）"
          value={classForm.grade} onChange={e => setClassForm({ ...classForm, grade: e.target.value })} style={inputStyle} />
        <select aria-label={`${teacher.display_name} 的新班级层次`} value={classForm.level}
          onChange={e => setClassForm({ ...classForm, level: e.target.value as TeacherClassLevel })} style={inputStyle}>
          {Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit" disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>新建班级</button>
      </form>
    </section>
  );
}

function ClassMembers({
  teacherClass,
  onCountChanged,
}: {
  teacherClass: AdminTeacherClass;
  onCountChanged: (count: number) => void;
}) {
  const [members, setMembers] = useState<AdminClassMember[] | null>(null);
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [grantor, setGrantor] = useState<'school' | 'guardian'>('school');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listClassMembers(teacherClass.id)
      .then(setMembers)
      .catch((e: any) => setError(e.message || '加载学生失败'));
  }, [teacherClass.id]);

  const update = (next: AdminClassMember[]) => {
    setMembers(next);
    onCountChanged(next.length);
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !members) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.addClassMember(teacherClass.id, username.trim(), grantor);
      if (result.added) update([...members, result.member]);
      else setError(`${result.member.display_name} 已在这个班级`);
      setUsername('');
    } catch (e: any) {
      setError(e.message || '加入失败');
    } finally {
      setBusy(false);
    }
  };

  const authorize = async (studentIds: string[], granted: boolean, grantor: 'school' | 'guardian' = 'school') => {
    if (!studentIds.length) return;
    setBusy(true);
    setError(null);
    try {
      update(await api.recordAiAuthorization(teacherClass.id, { student_ids: studentIds, granted, grantor }));
    } catch (e: any) {
      setError(e.message || '登记失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: AdminClassMember) => {
    if (!members) return;
    setError(null);
    try {
      await api.removeClassMember(teacherClass.id, member.id);
      update(members.filter(item => item.id !== member.id));
    } catch (e: any) {
      setError(e.message || '移除失败');
    }
  };

  return (
    <div style={{ borderTop: '1px solid #f0f0f0', padding: '10px', background: '#fafafa' }}>
      <form autoComplete="off" onSubmit={add} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input aria-label={`加入 ${teacherClass.name} 的学生用户名`} placeholder="学生账号（已有的 App 账号）"
          value={username} onChange={e => setUsername(e.target.value)} style={{ ...inputStyle, width: 260 }} />
        <select aria-label="入班授权方" value={grantor} onChange={e => setGrantor(e.target.value as 'school' | 'guardian')}
          style={{ ...inputStyle, width: 150 }}>
          <option value="school">依据学校授权</option>
          <option value="guardian">依据监护人授权</option>
        </select>
        <button type="submit" disabled={busy || !members} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>加入班级</button>
      </form>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: '#888' }}>
        推荐让学生用老师的邀请码入班（会看到共享说明并填写真实姓名）。直接加入时，须已取得学校或监护人对“班级老师查看学情”的授权，系统会记录授权方。
      </p>
      {members && members.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: '#555' }}>
          <span>
            AI 识别批改授权：{members.filter(m => m.teacher_ai_authorized).length} / {members.length} 人
            （依据学校或监护人的书面授权登记，未授权学生的作业由老师人工录入）
          </span>
          <button style={miniBtn} disabled={busy}
            onClick={() => authorize(members.filter(m => !m.teacher_ai_authorized).map(m => m.id), true, 'school')}>
            登记全班学校书面授权
          </button>
        </div>
      )}
      {error && <div style={{ ...errorBox, marginBottom: 8 }}>{error}</div>}
      {!members ? (
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>正在加载...</div>
      ) : members.length === 0 ? (
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>班级里还没有学生。</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {members.map(member => (
            <span key={member.id} style={memberChip}>
              {member.display_name}
              <span style={{ color: '#8c8c8c' }}>{member.username}</span>
              {member.status !== 'active' && <span style={{ color: '#cf1322' }}>停用</span>}
              <button
                aria-label={`${member.teacher_ai_authorized ? '撤回' : '登记'} ${member.display_name} 的 AI 授权`}
                disabled={busy}
                onClick={() => authorize([member.id], !member.teacher_ai_authorized, member.teacher_ai_grantor || 'school')}
                style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: 12,
                  color: member.teacher_ai_authorized ? '#389e0d' : '#8c8c8c' }}>
                {member.teacher_ai_authorized ? 'AI 已授权' : 'AI 未授权'}
              </button>
              <button aria-label={`从 ${teacherClass.name} 移除 ${member.display_name}`} onClick={() => remove(member)}
                style={{ border: 'none', background: 'none', color: '#cf1322', cursor: 'pointer', padding: 0 }}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const cardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e8e8e8',
  borderRadius: 8,
  padding: 16,
};

const errorBox: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 6,
  background: '#fff2f0',
  color: '#cf1322',
  marginBottom: 12,
};

const noticeBox: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 6,
  background: '#f6ffed',
  color: '#389e0d',
  marginBottom: 12,
};

const memberChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  border: '1px solid #e8e8e8',
  borderRadius: 12,
  background: '#fff',
  fontSize: 12,
};

const dialogLabel: CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: '#333',
};

const inputStyle: CSSProperties = {
  height: 36,
  borderRadius: 6,
  border: '1px solid #d9d9d9',
  padding: '0 10px',
  fontSize: 13,
};

const primaryBtn: CSSProperties = {
  border: 'none',
  borderRadius: 6,
  background: ACCENT,
  color: '#fff',
  padding: '0 14px',
  cursor: 'pointer',
  fontWeight: 700,
};

const secondaryBtn: CSSProperties = {
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  background: '#fff',
  color: '#555',
  padding: '8px 14px',
  cursor: 'pointer',
};

const miniBtn: CSSProperties = {
  border: '1px solid #d9d9d9',
  borderRadius: 5,
  background: '#fff',
  color: '#555',
  padding: '4px 8px',
  cursor: 'pointer',
  fontSize: 12,
};

const dangerMiniBtn: CSSProperties = {
  ...miniBtn,
  border: '1px solid #ffa39e',
  color: '#cf1322',
};
