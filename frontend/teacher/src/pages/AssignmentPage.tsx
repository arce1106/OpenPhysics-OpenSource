import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import AssignmentWorkspace from '../components/AssignmentWorkspace';
import { Composer } from './ComposePage';
import PersonalizedPage from './PersonalizedPage';
import SavedPaperView from './SavedPaperView';
import type { AssignmentDetail } from '../types';

export default function AssignmentPage() {
  const { assignmentId = '' } = useParams();
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError('');
    api.assignment(assignmentId)
      .then((next) => active && setDetail(next))
      .catch((err) => active && setError(err instanceof Error ? err.message : '加载失败'));
    // Answer areas are resized in the print preview tab; pick those changes up on return,
    // so the next save here does not write the old heights back.
    const refresh = () => {
      api.assignment(assignmentId).then((next) => active && setDetail(next)).catch(() => undefined);
    };
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [assignmentId]);

  if (error && !detail) {
    return (
      <section>
        <p className="error" role="alert">{error}</p>
        <Link to="/papers">返回作业管理</Link>
      </section>
    );
  }
  if (!detail) return <p className="muted">正在加载测验…</p>;
  if (detail.removed_at && (!detail.class_id || !detail.results_released_at)) return <section>
    <h1>{detail.title}</h1><p role="status">该作业已删除，已有学习记录会保留。</p>
    <Link to="/papers">返回作业管理</Link>
  </section>;
  if (detail.kind === 'personalized' && detail.status !== 'published') return <PersonalizedPage detail={detail} onChange={setDetail} />;
  if (detail.status === 'draft') return <Composer detail={detail} onChange={setDetail} />;
  // A paper of the teacher's own, saved: download, publish to classes, follow them.
  if (!detail.class_id) return <SavedPaperView detail={detail} />;
  return <AssignmentWorkspace key={detail.id} detail={detail} />;
}
