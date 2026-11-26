import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatPoints } from '../labels';
import type { ClassHomework } from '../types';

type HistoryStudent = ClassHomework['students'][number];
/** 'number' and 'name' sort the roster; any other key is an assignment id, sorted by score rate. */
export type ScoreSort = { key: string; dir: 'asc' | 'desc' } | null;

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true });

/** Personalized homework gives each student a different full score, so scores compare as rates. */
function scoreRate(student: HistoryStudent, assignmentId: string): number | null {
  const cell = student.scores[assignmentId];
  if (!cell) return null;
  return cell.full ? cell.score / cell.full : cell.score;
}

/** Sorted copy; students without a score (缺交 or not given it) stay last in either direction. */
export function sortScoreHistory(students: HistoryStudent[], sort: ScoreSort): HistoryStudent[] {
  if (!sort) return students;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...students].sort((a, b) => {
    if (sort.key === 'number' || sort.key === 'name') {
      const pick = (s: HistoryStudent) => (sort.key === 'number' ? s.student_number : s.display_name) ?? '';
      const [x, y] = [pick(a), pick(b)];
      if (!x !== !y) return x ? -1 : 1;
      return sign * collator.compare(x, y);
    }
    const [x, y] = [scoreRate(a, sort.key), scoreRate(b, sort.key)];
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return sign * (x - y) || collator.compare(a.student_number ?? '', b.student_number ?? '');
  });
}

/** Scores open highest first, the roster in order; a second click reverses, a third restores. */
export function nextScoreSort(current: ScoreSort, key: string): ScoreSort {
  const first = key === 'number' || key === 'name' ? 'asc' : 'desc';
  if (current?.key !== key) return { key, dir: first };
  return current.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : null;
}

/** Long-term class history; each assignment opens its own management workspace. */
export default function ClassScoreHistory({ classId, studentId, onClearStudent }: { classId: string; studentId?: string; onClearStudent?: () => void }) {
  const [homework, setHomework] = useState<ClassHomework | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [sort, setSort] = useState<ScoreSort>(null);
  useEffect(() => {
    let active = true;
    setHomework(null);
    setError('');
    api.classHomework(classId).then((next) => active && setHomework(next))
      .catch((err) => active && setError(err instanceof Error ? err.message : '成绩记录加载失败'));
    return () => { active = false; };
  }, [classId, attempt]);
  if (error) return <div className="card"><p className="error" role="alert">{error}</p><button onClick={() => setAttempt((n) => n + 1)}>重试成绩记录</button></div>;
  if (!homework) return <p className="muted">正在加载成绩记录…</p>;
  const released = homework.assignments.filter((row) => row.results_released_at);
  const shown = released.filter((row) => row.title.includes(search.trim()));
  const students = sortScoreHistory(
    studentId ? homework.students.filter((s) => s.student_id === studentId) : homework.students, sort);
  const sortHeader = (key: string, label: string, title: string) => {
    const active = sort?.key === key ? sort.dir : null;
    return (
      <button type="button" className="sort-button" title={`按${title}排序`} aria-label={`按${title}排序`} onClick={() => setSort(nextScoreSort(sort, key))}>
        {label}<span aria-hidden="true" className={active ? 'sort-mark active' : 'sort-mark'}>{active === 'asc' ? '↑' : active === 'desc' ? '↓' : '↕'}</span>
      </button>
    );
  };
  const ariaSort = (key: string) => (sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined);
  return <section aria-label="作业成绩记录">
      {released.length > 0 ? (
        <div className="card class-stat-card">
          <div className="class-stat-card-head"><div><h2>历次成绩</h2><p className="muted small">查看已发布结果的作业，点击名称进入单份作业分析。</p></div><span className="muted small">{shown.length} 份成绩</span></div>
          <div className="class-stat-filters"><input type="search" aria-label="查找历次作业" placeholder="查找作业名称" value={search} onChange={(e) => setSearch(e.target.value)} />
            {studentId && <span className="class-history-filter">{students[0]?.display_name ?? '指定学生'} {onClearStudent && <button onClick={onClearStudent}>查看全班</button>}</span>}
          </div>
          <p className="muted small">已发布结果的作业，每格为得分 / 满分；个性化作业每人满分不同，按得分率排序。“缺交”是已布置但没交，“—”是未参与本次作业，排序时都排在最后。点表头排序，再点一次反向，第三次恢复原顺序。</p>
          <div className="table-scroll">
            <table aria-label="成绩表">
              <thead>
                <tr>
                  <th aria-sort={ariaSort('number')}>{sortHeader('number', '学号', '学号')}</th>
                  <th aria-sort={ariaSort('name')}>{sortHeader('name', '姓名', '姓名')}</th>
                  {shown.map((row) => (
                    <th key={row.id} title={row.title} aria-sort={ariaSort(row.id)}>
                      <span className="score-head">
                        <Link to={`/assignments/${row.id}?tab=students`}>{row.title}</Link>
                        {sortHeader(row.id, '', `「${row.title}」得分率`)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.student_id}>
                    <td>{student.student_number ?? '—'}</td>
                    <td>{student.display_name}</td>
                    {shown.map((row) => {
                      const cell = student.scores[row.id];
                      const missed = (student.missing ?? []).includes(row.id);
                      return (
                        <td key={row.id} className={missed ? 'error' : undefined}>
                          {cell ? `${formatPoints(cell.score)}${cell.full != null ? ` / ${formatPoints(cell.full)}` : ''}`
                            : missed ? '缺交' : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!shown.length && <p className="class-stat-empty">没有符合条件的作业成绩。</p>}
        </div>
      ) : <div className="card empty"><h2>暂无已发布成绩</h2><p className="muted">发布作业结果后，这里显示历次成绩。未发布的成绩不进入统计。</p></div>}
  </section>;
}
