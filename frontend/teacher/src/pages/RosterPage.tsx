import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { ClassHeader } from '../components/ClassNav';
import Modal from '../components/Modal';
import type { TeacherClassDetail } from '../types';

/** Student numbers are what students write on paper homework, so scans can be matched to them. */
export default function RosterPage() {
  const { classId = '' } = useParams();
  return <Roster key={classId} classId={classId} />;
}

function Roster({ classId }: { classId: string }) {
  const [detail, setDetail] = useState<TeacherClassDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<TeacherClassDetail['members'][number] | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    api.classDetail(classId)
      .then(value => { if (active) setDetail(value); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : '加载失败'); });
    return () => { active = false; };
  }, [classId]);

  async function run(action: () => Promise<TeacherClassDetail>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      setDetail(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function commit(studentId: string, current: string | null, raw: string) {
    const value = raw.trim() || null;
    if (value === current) return;
    void run(() => api.setMemberNumber(classId, studentId, value));
  }

  if (!detail) {
    return error ? (
      <section>
        <p className="error" role="alert">{error}</p>
        <Link to="/classes">返回我的班级</Link>
      </section>
    ) : <p className="muted">正在加载名单…</p>;
  }
  const missing = detail.members.filter((member) => !member.student_number).length;
  // Two students with the same name are easy to mix up on paper: say so next to both.
  const sameName = new Set(detail.members.map((m) => m.display_name)
    .filter((name, index, names) => names.indexOf(name) !== index));
  const unregistered = detail.members.filter((m) => !m.joined_via).length;

  return (
    <section>
      <ClassHeader detail={detail} />
      <div className="card">
        <div className="roster-toolbar">
          <button type="button" disabled={busy} onClick={() => run(() => api.classDetail(classId))}>刷新名单</button>
          {detail.members.length > 0 && (missing > 0
            ? <button type="button" disabled={busy} onClick={() => run(() => api.autoNumber(classId))}>为 {missing} 名未编号学生自动编号</button>
            : <span className="muted small">全部已编号</span>)}
        </div>
        <p className="muted roster-note">
          学生在纸质作业上写学号，收卷时按学号认人，学号在本班内不能重复。
          已布置的作业仍按布置时的学号收卷，改学号只影响以后布置的作业。
          姓名由学生入班时填写，学生可在“我的班级”里修改。
          AI 识别批改授权由管理员根据学校或监护人的书面授权登记。
        </p>
        {unregistered > 0 && (
          <p className="notice-warn" role="note">
            {unregistered} 名学生是早期直接加入的，没有入班说明或授权记录。请让他们用邀请码重新确认，或请管理员补登学校/监护人授权。
          </p>
        )}
        {error && !removing && <p className="error" role="alert">{error}</p>}
        {detail.members.length === 0 ? (
          <div className="empty">
            <p>这个班级还没有学生。</p>
            <p className="muted">回到“我的班级”，在班级卡片中点击“邀请学生”，将邀请码发给学生。</p>
          </div>
        ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>学号</th><th>姓名</th><th>加入方式</th><th>学生 App</th><th>AI 识别批改授权</th><th>操作</th></tr>
            </thead>
            <tbody>
              {detail.members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <input
                      aria-label={`${member.display_name} 的学号`}
                      className="number-input"
                      inputMode="numeric"
                      maxLength={4}
                      defaultValue={member.student_number ?? ''}
                      key={`${member.id}-${member.student_number}`}
                      disabled={busy}
                      onBlur={(event) => commit(member.id, member.student_number, event.target.value)}
                    />
                  </td>
                  <td>
                    {member.display_name}
                    {sameName.has(member.display_name) && <span className="student-no-data">同名，请以学号区分</span>}
                    {/\d{3}\*{4}\d{4}/.test(member.display_name) && <span className="student-no-data">还没有填写真实姓名，请提醒学生在“我的班级”里修改</span>}
                  </td>
                  <td className={member.joined_via ? 'muted' : 'warn-text'}>
                    {member.joined_via === 'invitation' ? '邀请码入班' : member.joined_via === 'admin' ? '管理员登记' : '未登记授权'}
                    {member.joined_at && <span className="student-no-data">{new Date(member.joined_at).toLocaleDateString('zh-CN')}</span>}
                  </td>
                  <td className={member.last_login_at ? '' : 'muted'}>
                    {member.last_login_at ? '用过学生端' : '未登录（默认打印）'}
                    {member.app_ai_declined && <span className="student-no-data warn-text">已拒绝 App 内 AI 批改：App 作业的主观题无法提交，请给他打印</span>}
                  </td>
                  <td className={member.teacher_ai_authorized ? '' : 'muted'}>
                    {member.teacher_ai_authorized ? '已授权' : '未授权（人工录入）'}
                  </td>
                  <td><button type="button" disabled={busy} onClick={() => setRemoving(member)} aria-label={`移出 ${member.display_name}`}>移出班级</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        {removing && <Modal label="移出学生" onClose={() => { if (!busy) setRemoving(null); }}>
          {error && <p className="error" role="alert">{error}</p>}
          <p>将 {removing.display_name} 移出本班？</p>
          <p className="muted">移出后停止共享该生当前学情，不能继续提交本班作业。已有作业和成绩保留，重新加入需使用新生成的邀请码。</p>
          <div className="actions"><button type="button" className="danger" disabled={busy} onClick={async () => {
            const member = removing;
            await run(async () => { const result = await api.removeClassMember(classId, member.id); setRemoving(null); return result; });
          }}>移出 {removing.display_name}</button><button type="button" disabled={busy} onClick={() => setRemoving(null)}>取消</button></div>
        </Modal>}
      </div>
    </section>
  );
}
