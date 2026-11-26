import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../api/client';
import type { Student } from '../types';
import ConfirmDialog from './ConfirmDialog';

const ACCENT = '#14919b';
const STUDENT_GRID = '1fr 0.85fr 0.9fr 0.6fr 0.75fr 0.75fr 0.65fr 300px';
type StudentAction =
  | { kind: 'status'; student: Student }
  | { kind: 'edit'; student: Student }
  | { kind: 'password'; student: Student }
  | { kind: 'reset'; student: Student };

const MIN_PASSWORD_LENGTH = 6;

function studentLabel(student: Student): string {
  return student.display_name || student.username;
}

function formatStatus(status: string): { label: string; color: string } {
  if (status === 'active') return { label: '启用', color: '#389e0d' };
  if (status === 'disabled') return { label: '停用', color: '#cf1322' };
  return { label: '未激活', color: '#8c8c8c' };
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    username: '',
    password: '',
    class_name: '',
  });
  const [action, setAction] = useState<StudentAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ displayName: '', className: '', password: '', confirmText: '' });
  const [keyword, setKeyword] = useState('');

  const visibleStudents = useMemo(() => {
    const term = keyword.trim().toLowerCase();
    if (!term) return students;
    return students.filter(student => [
      student.username, student.display_name, student.phone, student.class_name,
    ].some(value => (value || '').toLowerCase().includes(term)));
  }, [keyword, students]);

  const fetchStudents = async () => {
    setLoading(true);
    setError(null);
    try {
      setStudents(await api.listStudents());
    } catch (e: any) {
      setError(e.message || '加载学生失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStudents(); }, []);

  const handleCreate = async () => {
    if (!form.username.trim() || !form.password.trim()) {
      setError('请填写账号和初始密码');
      return;
    }
    if (form.password.trim().length < MIN_PASSWORD_LENGTH) {
      setError(`初始密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.createStudent({
        username: form.username.trim(),
        password: form.password,
        class_name: form.class_name.trim() || undefined,
      });
      setForm({ username: '', password: '', class_name: '' });
      await fetchStudents();
      setNotice('学生账号已创建，启用后即可使用完整学习功能');
    } catch (e: any) {
      setError(e.message || '创建学生失败');
    } finally {
      setSaving(false);
    }
  };

  const openAction = (next: StudentAction) => {
    const { student } = next;
    setDraft({
      displayName: student.display_name || '',
      className: student.class_name || '',
      password: '',
      confirmText: '',
    });
    setActionError(null);
    setAction(next);
  };

  const closeAction = () => {
    if (actionBusy) return;
    setAction(null);
    setActionError(null);
  };

  const runAction = async () => {
    if (!action) return;
    const { student } = action;
    setActionBusy(true);
    setActionError(null);
    try {
      let message = '';
      if (action.kind === 'status') {
        const status = student.status === 'active' ? 'disabled' : 'active';
        await api.updateStudent(student.id, { status });
        message = status === 'active' ? '学生账号已启用' : '学生账号已停用';
      } else if (action.kind === 'edit') {
        await api.updateStudent(student.id, {
          display_name: draft.displayName.trim() || student.display_name,
          class_name: draft.className.trim(),
        });
        message = '学生信息已更新';
      } else if (action.kind === 'password') {
        await api.resetStudentPassword(student.id, draft.password);
        message = `${studentLabel(student)} 的密码已重置，旧登录会话已失效`;
      } else {
        const result = await api.resetStudentAccount(student.id);
        const deletedTotal = Object.values(result.deleted || {}).reduce((sum, value) => sum + value, 0);
        message = `学生账号已重置为新建状态，清理 ${deletedTotal} 条学习数据`;
      }
      setAction(null);
      setError(null);
      setNotice(message);
      if (action.kind !== 'password') await fetchStudents();
    } catch (e: any) {
      setActionError(e.message || '操作失败，请重试');
    } finally {
      setActionBusy(false);
    }
  };

  const actionDialog = (() => {
    if (!action) return null;
    const { student } = action;
    const label = studentLabel(student);
    switch (action.kind) {
      case 'status':
        return student.status === 'active'
          ? {
            title: `停用 ${label}`,
            message: '停用后该学生无法登录，学习数据保留，可随时重新启用。',
            confirmLabel: '停用',
            tone: 'danger' as const,
            confirmDisabled: false,
            body: null,
          }
          : {
            title: `启用 ${label}`,
            message: '启用后该学生可以重新登录。',
            confirmLabel: '启用',
            tone: 'default' as const,
            confirmDisabled: false,
            body: null,
          };
      case 'edit':
        return {
          title: `编辑 ${student.username}`,
          message: '',
          confirmLabel: '保存',
          tone: 'default' as const,
          confirmDisabled: false,
          body: (
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={dialogLabel}>
                姓名
                <input autoFocus autoComplete="off" value={draft.displayName}
                  onChange={e => setDraft(prev => ({ ...prev, displayName: e.target.value }))} style={inputStyle} />
              </label>
              <label style={dialogLabel}>
                班级（留空表示未分班）
                <input autoComplete="off" value={draft.className}
                  onChange={e => setDraft(prev => ({ ...prev, className: e.target.value }))} style={inputStyle} />
              </label>
            </div>
          ),
        };
      case 'password': {
        const tooShort = draft.password.trim().length < MIN_PASSWORD_LENGTH;
        return {
          title: `重置 ${label} 的密码`,
          message: '重置后该学生已登录的设备需要用新密码重新登录。',
          confirmLabel: '重置密码',
          tone: 'danger' as const,
          confirmDisabled: tooShort,
          body: (
            <label style={dialogLabel}>
              新密码（至少 {MIN_PASSWORD_LENGTH} 位）
              <input autoFocus type="password" autoComplete="new-password" name="reset-student-password"
                value={draft.password}
                onChange={e => setDraft(prev => ({ ...prev, password: e.target.value }))} style={inputStyle} />
            </label>
          ),
        };
      }
      case 'reset':
        return {
          title: `重置 ${label} 的学习数据`,
          message: '这会清空学习记录、错题、掌握度、奖励成长和纸笔上传痕迹；账号、密码、班级保留。此操作不可撤销。',
          confirmLabel: '清空并重置',
          tone: 'danger' as const,
          confirmDisabled: draft.confirmText !== 'RESET',
          body: (
            <label style={dialogLabel}>
              请输入 RESET 确认
              <input autoFocus autoComplete="off" value={draft.confirmText}
                onChange={e => setDraft(prev => ({ ...prev, confirmText: e.target.value }))} style={inputStyle} />
            </label>
          ),
        };
    }
  })();

  return (
    <div style={{ padding: 24, overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1d23' }}>学生管理</div>
          <div style={{ fontSize: 13, color: '#777', marginTop: 4 }}>
            管理学生账号、密码、班级和启停状态。
          </div>
        </div>
        <button onClick={fetchStudents} style={secondaryBtn}>刷新</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 6, background: '#fff2f0', color: '#cf1322', marginBottom: 12 }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{ padding: '10px 14px', borderRadius: 6, background: '#f6ffed', color: '#389e0d', marginBottom: 12 }}>
          {notice}
        </div>
      )}

      {/* 这是“新建学生账号”的表单，不是管理员登录：关闭浏览器自动填充，
          避免把已保存的管理员账号、密码填进班级和初始密码。 */}
      <form
        autoComplete="off"
        onSubmit={event => { event.preventDefault(); void handleCreate(); }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr)) auto', gap: 8, marginBottom: 18 }}
      >
        <input
          aria-label="新学生账号"
          name="new-student-username"
          autoComplete="off"
          placeholder="账号"
          value={form.username}
          onChange={e => setForm({ ...form, username: e.target.value })}
          style={inputStyle}
        />
        <input
          aria-label="新学生班级"
          name="new-student-class"
          autoComplete="off"
          placeholder="班级（可选）"
          value={form.class_name}
          onChange={e => setForm({ ...form, class_name: e.target.value })}
          style={inputStyle}
        />
        <input
          aria-label="新学生初始密码"
          name="new-student-password"
          type="password"
          autoComplete="new-password"
          placeholder="初始密码（至少 6 位）"
          value={form.password}
          onChange={e => setForm({ ...form, password: e.target.value })}
          style={inputStyle}
        />
        <button type="submit" disabled={saving} style={{
          ...primaryBtn,
          opacity: saving ? 0.6 : 1,
        }}>
          {saving ? '创建中...' : '创建学生'}
        </button>
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <input
          aria-label="搜索学生"
          type="search"
          autoComplete="off"
          placeholder="搜索账号、姓名、手机号或班级"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ ...inputStyle, width: 280 }}
        />
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>
          {keyword.trim() ? `匹配 ${visibleStudents.length} / ${students.length} 人` : `共 ${students.length} 人`}
        </span>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: STUDENT_GRID, padding: '10px 14px', background: '#fafafa', fontSize: 12, color: '#777', fontWeight: 700 }}>
          <span>账号</span>
          <span>姓名</span>
          <span>手机号</span>
          <span>年级</span>
          <span>班级</span>
          <span>来源</span>
          <span>状态</span>
          <span>操作</span>
        </div>

        {loading ? (
          <div style={{ padding: 24, color: '#999', textAlign: 'center' }}>加载中...</div>
        ) : visibleStudents.length === 0 ? (
          <div style={{ padding: 24, color: '#999', textAlign: 'center' }}>{students.length === 0 ? '暂无学生' : '没有匹配的学生'}</div>
        ) : visibleStudents.map(student => {
          const status = formatStatus(student.status);
          return (
            <div
              key={student.id}
              style={{
                display: 'grid',
                gridTemplateColumns: STUDENT_GRID,
                padding: '12px 14px',
                borderTop: '1px solid #f0f0f0',
                alignItems: 'center',
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 700 }}>{student.username}</span>
              <span>{student.display_name}</span>
              <span style={{ color: '#777' }}>{student.phone || '-'}</span>
              <span style={{ color: '#777' }}>{student.grade || '-'}</span>
              <span style={{ color: '#777' }}>{student.class_name || '-'}</span>
              <span style={{ color: '#4f5968', fontWeight: 700 }}>
                {student.account_source === 'self_registered' ? '自主注册' : '学校创建'}
              </span>
              <span style={{ color: status.color, fontWeight: 700 }}>
                {status.label}
              </span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => openAction({ kind: 'status', student })} style={miniBtn}>
                  {student.status === 'active' ? '停用' : '启用'}
                </button>
                <button onClick={() => openAction({ kind: 'edit', student })} style={miniBtn}>
                  编辑
                </button>
                <button onClick={() => openAction({ kind: 'password', student })} style={miniBtn}>
                  重置密码
                </button>
                <button onClick={() => openAction({ kind: 'reset', student })} style={dangerMiniBtn}>
                  重置账号
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={action !== null && actionDialog !== null}
        title={actionDialog?.title || ''}
        message={actionDialog?.message || undefined}
        confirmLabel={actionDialog?.confirmLabel}
        tone={actionDialog?.tone}
        busy={actionBusy}
        confirmDisabled={actionDialog?.confirmDisabled}
        error={actionError}
        onConfirm={() => { void runAction(); }}
        onCancel={closeAction}
      >
        {actionDialog?.body}
      </ConfirmDialog>
    </div>
  );
}

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
