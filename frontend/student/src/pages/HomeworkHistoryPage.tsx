import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { HistoryEmptyState, HistoryHeader } from '../components/history';
import { buildReturnState, navigateBackToPreviousPage } from '../utils/navigation';
import { homeworkAverage, homeworkRecordMeta, homeworkRecordStatus, homeworkScore } from '../utils/teacherHomework';
import type { TeacherHomework } from '../types';

/** 作业记录: every teacher homework the student has had, newest first. Home shows only the latest. */
export default function HomeworkHistoryPage() {
  const [items, setItems] = useState<TeacherHomework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const average = homeworkAverage(items);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.listTeacherHomework({ history: true }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法加载老师作业');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="history-workspace">
      <HistoryHeader
        title="作业记录"
        subtitle="按时间查看老师布置的每次作业，打开可看答卷和批改。"
        onBack={() => navigateBackToPreviousPage(navigate, location, '/')}
        actions={(
          <div className="homework-record-badges">
            <span><strong>{items.length}</strong>份作业</span>
            {average != null && <span><strong>{average}</strong>平均分</span>}
          </div>
        )}
      />

      {loading ? (
        <div className="loading">正在加载老师作业...</div>
      ) : error ? (
        <HistoryEmptyState title="暂时无法加载老师作业" description={error} actionLabel="重试" onAction={load} />
      ) : items.length === 0 ? (
        <HistoryEmptyState title="还没有老师作业" description="老师布置后，可在这里查看每次作业的得分和答卷。" />
      ) : (
        <section className="homework-record-list" aria-label="作业列表">
          <p>得分按百分制显示</p>
          {items.map((item) => {
            const { status, note } = homeworkRecordStatus(item);
            const scored = item.status === 'completed' && !!homeworkScore(item);
            return (
              <Link key={item.attempt_id} className="homework-record-row"
                to={`/homework/${encodeURIComponent(item.attempt_id)}`} state={buildReturnState(location)}>
                <span className="homework-record-main">
                  <strong>{item.title}</strong>
                  <small>{homeworkRecordMeta(item)}</small>
                </span>
                <span className="homework-record-result">
                  <b className={scored ? 'is-scored' : undefined}>{status}</b>
                  {note && <small>{note}</small>}
                </span>
                <span aria-hidden="true" className="homework-record-arrow">›</span>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
