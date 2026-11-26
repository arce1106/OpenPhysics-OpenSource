import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { CLASS_LEVEL_LABELS, classProgress } from '../labels';
import InviteStudents from '../components/InviteStudents';
import type { LibraryEntry, TeacherClassSummary } from '../types';

/** What is waiting in each class: drafts to review and publish, and homework still open. */
function pendingByClass(entries: LibraryEntry[]): Map<string, string> {
  const counts = new Map<string, { drafts: number; open: number }>();
  for (const entry of entries) {
    for (const row of entry.classes) {
      const current = counts.get(row.class_id) ?? { drafts: 0, open: 0 };
      if (row.status === 'draft') current.drafts += 1;
      else if (!row.results_released_at) current.open += 1;
      counts.set(row.class_id, current);
    }
  }
  return new Map([...counts].map(([classId, { drafts, open }]) => [classId, [
    drafts && `${drafts} 份待审核发布`, open && `${open} 份在收卷或批改`,
  ].filter(Boolean).join('，')]));
}

/** The most recent homework given to each class, for a line on its card. */
function latestByClass(entries: LibraryEntry[]): Map<string, string> {
  const latest = new Map<string, { at: string; text: string }>();
  for (const entry of entries) {
    for (const row of entry.classes) {
      const at = row.created_at ?? '';
      const current = latest.get(row.class_id);
      if (!current || at > current.at) latest.set(row.class_id, { at, text: `${entry.title} · ${classProgress(row)}` });
    }
  }
  return new Map([...latest].map(([classId, value]) => [classId, value.text]));
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<TeacherClassSummary[] | null>(null);
  const [latest, setLatest] = useState<Map<string, string>>(new Map());
  const [pending, setPending] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState('');

  useEffect(() => {
    api.classes().then(setClasses).catch((err) => setError(err instanceof Error ? err.message : '加载失败'));
    // The latest homework line is extra: without it the cards still show.
    api.library().then((entries) => {
      setLatest(latestByClass(entries));
      setPending(pendingByClass(entries));
    }).catch(() => undefined);
  }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!classes) return <p className="muted">正在加载班级…</p>;

  return (
    <section>
      <h1>我的班级</h1>
      {classes.length === 0 ? (
        <div className="card empty">
          <p>你还没有班级。</p>
          <p className="muted">请联系管理员为你创建班级，之后可在班级中邀请学生。</p>
        </div>
      ) : (
        <ul className="class-grid">
          {classes.map((item) => (
            <li key={item.id}>
              <article className="card class-card" aria-label={item.name}>
                <div className="class-card-heading">
                  <Link to={`/classes/${item.id}`} className="class-card-title"><strong>{item.name}</strong></Link>
                  {!item.archived && <InviteStudents classId={item.id} className={item.name} />}
                </div>
                <span className="muted">
                  {[item.grade, CLASS_LEVEL_LABELS[item.level]].filter(Boolean).join(' · ')}
                </span>
                <span>{item.member_count === 0 ? '还没有学生，可先邀请学生' : `${item.member_count} 名学生`}</span>
                <span className="muted small">最近作业：{latest.get(item.id) ?? '还没有'}</span>
                {pending.get(item.id) && <span className="pending-line">待处理：{pending.get(item.id)}</span>}
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
