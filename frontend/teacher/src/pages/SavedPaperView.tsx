import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import NextStep from '../components/NextStep';
import PdfDownloadButton from '../components/PdfDownloadButton';
import AssignDialog from '../components/AssignDialog';
import DeleteAssignmentDialog from '../components/DeleteAssignmentDialog';
import type { DeliveryMode } from '../components/DeliveryChoice';
import { classProgress, formatPoints, shortDate } from '../labels';
import type { AssignmentDetail, TeacherClassSummary } from '../types';


/**
 * A saved paper in 我的组卷: fixed as printed. The teacher downloads the PDF to print, publishes it
 * to classes, and follows each class from here into collecting, grading and the report.
 */
export default function SavedPaperView({ detail }: {
  detail: AssignmentDetail;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const carried = (location.state as { saved?: boolean; delivery?: DeliveryMode } | null) ?? {};
  const [classes, setClasses] = useState<TeacherClassSummary[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notice = carried.saved ? '试卷已保存。' : '';
  const assigned = detail.assigned ?? [];

  async function openAssignment() {
    setBusy(true);
    setError('');
    try {
      setClasses(await api.classes());
      setAssigning(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '班级加载失败');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setBusy(true);
    setError('');
    try {
      const paper = await api.copyAssignment(detail.id);
      navigate(`/assignments/${paper.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '复制失败');
      setBusy(false);
    }
  }

  return (
    <section className="saved-paper">
      <Link to="/papers" className="back-link">← 作业管理</Link>
      <div className="composer-head">
        <h1>{detail.title}</h1>
        <span className="chip saved">已保存 · 不可修改</span>
      </div>
      <p className="muted">
        {detail.question_count} 题 · {formatPoints(detail.total_points ?? 0)} 分
        {detail.published_at && ` · 保存于 ${shortDate(detail.published_at)}`}
      </p>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <ol className="saved-steps">
        <li className="card">
          <h2>试卷</h2>
          <div className="paper-actions">
            <PdfDownloadButton assignmentId={detail.id} title={detail.title} className="primary" />
            <Link to={`/assignments/${detail.id}/print`} target="_blank" className="secondary-link">预览</Link>
            <Link to={`/assignments/${detail.id}/print?edition=teacher`} target="_blank" className="secondary-link">教师版预览</Link>
            <PdfDownloadButton assignmentId={detail.id} title={detail.title} edition="teacher" />
            <button type="button" disabled={busy} onClick={copy}>复制一份再修改</button>
            <button type="button" disabled={busy} onClick={() => void openAssignment()}>布置到班级</button>
            <button type="button" className="danger" disabled={busy} onClick={() => setDeleting(true)}>删除试卷</button>
          </div>
        </li>

        <li className="card">
          <h2>已布置的班级</h2>
          {assigned.length === 0 ? (
            <p className="muted small">尚未布置到班级。</p>
          ) : (
            <table aria-label="已发布的班级">
              <thead><tr><th>班级</th><th>发布</th><th>进度</th><th>下一步</th></tr></thead>
              <tbody>
                {assigned.map((row) => (
                  <tr key={row.id}>
                    <td><Link to={`/assignments/${row.id}`}>{row.class_name}</Link></td>
                    <td>{shortDate(row.published_at ?? row.created_at)}</td>
                    <td>{classProgress(row)}</td>
                    <td><NextStep row={row} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </li>
      </ol>
      {assigning && <AssignDialog assignmentId={detail.id} title={detail.title} kind="test" classes={classes}
        assigned={assigned} initialDelivery={carried.delivery ?? 'paper'} onClose={() => setAssigning(false)}
        onDone={(created) => {
          setAssigning(false);
          if (created.length === 1) navigate(`/assignments/${created[0].id}`);
          else navigate('/papers', { state: { notice: `「${detail.title}」已布置给 ${created.length} 个班。` } });
        }} />}
      {deleting && <DeleteAssignmentDialog assignmentId={detail.id} title={detail.title} assignedCount={assigned.length}
        onClose={() => setDeleting(false)} onDeleted={() => navigate('/papers', { replace: true, state: { notice: `已删除“${detail.title}”` } })} />}

    </section>
  );
}
