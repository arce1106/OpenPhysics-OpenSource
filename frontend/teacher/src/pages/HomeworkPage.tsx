import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import AssignDialog from '../components/AssignDialog';
import HomeworkCard from '../components/HomeworkCard';
import DeleteAssignmentDialog from '../components/DeleteAssignmentDialog';
import type { AssignmentSummary, LibraryEntry, TeacherClassSummary } from '../types';

type KindFilter = 'all' | 'test' | 'personalized';

const KIND_FILTERS: Array<[KindFilter, string]> = [['all', '全部'], ['test', '测验'], ['personalized', '个性化作业']];

/** Teacher papers and personalized settings, with an independent workflow for each class. */
export default function HomeworkPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const classFilter = params.get('class') ?? '';
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [classes, setClasses] = useState<TeacherClassSummary[]>([]);
  const [kind, setKind] = useState<KindFilter>('all');
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [assigning, setAssigning] = useState<LibraryEntry | null>(null);
  const [deleting, setDeleting] = useState<LibraryEntry | null>(null);
  // A paper assigned from its own page to several classes comes back here with a note.
  const [notice, setNotice] = useState(() => (location.state as { notice?: string } | null)?.notice ?? '');
  const [error, setError] = useState('');

  const load = useCallback(() => Promise.all([api.library(), api.classes()])
    .then(([nextEntries, nextClasses]) => {
      setEntries(nextEntries);
      setClasses(nextClasses);
    })
    .catch((err) => setError(err instanceof Error ? err.message : '加载失败')), []);

  useEffect(() => {
    void load();
  }, [load]);

  async function copy(entry: LibraryEntry) {
    setError('');
    try {
      const paper = await api.copyAssignment(entry.id);
      navigate(`/assignments/${paper.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '复制失败');
    }
  }

  function created(assigned: AssignmentSummary[], kindCreated: string) {
    setAssigning(null);
    // One class: straight into its review; several: back to the list to pick one.
    if (kindCreated === 'personalized' && assigned.length === 1) {
      navigate(`/assignments/${assigned[0].id}`);
      return;
    }
    setNotice(kindCreated === 'personalized'
      ? `已为 ${assigned.length} 个班起草，点班级进入逐人审核`
      : `已发布给 ${assigned.length} 个班`);
    void load();
  }

  if (error && !entries) return <p className="error" role="alert">{error}</p>;
  if (!entries) return <p className="muted">正在加载作业…</p>;

  const target = classes.find((item) => item.id === classFilter);
  const words = search.trim();
  const shown = entries.filter((entry) => (kind === 'all' || entry.kind === kind)
    && (!words || entry.title.includes(words))
    // A class view also lists papers not given to any class yet: they can be assigned to it.
    && (!classFilter || entry.classes.length === 0 || entry.classes.some((row) => row.class_id === classFilter)));

  return (
    <section className="homework-management">
      <div className="homework-head">
        <div><h1>作业管理</h1><p className="muted">查看每份作业，跟进各班的收卷、审核与报告。</p></div>
        <Link to="/" className="primary-link">去组卷</Link>
      </div>

      <div className="homework-filters">
        <div className="segmented" role="group" aria-label="作业类型">
          {KIND_FILTERS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={kind === value} className={kind === value ? 'active' : ''}
              onClick={() => setKind(value)}>{label}</button>
          ))}
        </div>
        <input className="search-input" type="search" placeholder="按名称查找" aria-label="按名称查找作业"
          value={search} onChange={(event) => setSearch(event.target.value)} />
        <label className="toggle">
          班级
          <select aria-label="按班级查看" value={classFilter}
            onChange={(event) => setParams(event.target.value ? { class: event.target.value } : {})}>
            <option value="">全部班级</option>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>

      <p className="homework-count muted small">共 {shown.length} 份作业</p>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {shown.length === 0 ? (
        <div className="card empty">
          <p>{entries.length === 0 ? '还没有组过卷。' : '没有符合筛选的组卷。'}</p>
          {entries.length === 0 && <p className="muted">在“组卷”里从题库组一份测验，或为全班起草个性化作业，都会保存在这里。</p>}
        </div>
      ) : (
        <ul className="list homework-list">
          {shown.map((entry) => (
            <HomeworkCard key={entry.id} entry={entry} classFilter={classFilter}
              onAssign={() => setAssigning(entry)} onCopy={() => void copy(entry)}
              onDelete={() => setDeleting(entry)} />
          ))}
        </ul>
      )}

      {assigning && (
        <AssignDialog assignmentId={assigning.id} title={assigning.title} kind={assigning.kind}
          assigned={assigning.classes} classes={classes} initialDelivery={assigning.delivery ?? 'paper'}
          preselected={target ? [target.id] : []}
          onClose={() => setAssigning(null)} onDone={(assigned) => created(assigned, assigning.kind)} />
      )}
      {deleting && <DeleteAssignmentDialog assignmentId={deleting.id} title={deleting.title} assignedCount={deleting.classes.length}
        onClose={() => setDeleting(null)} onDeleted={() => {
          setEntries((current) => current?.filter((entry) => entry.id !== deleting.id) ?? null);
          setNotice(`已删除“${deleting.title}”`);
          setDeleting(null);
          // Refresh the whole card, including the class executions removed with its source.
          void load();
        }} />}
    </section>
  );
}
