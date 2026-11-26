import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { chapterRank } from '../catalog';
import { studentReturnContext } from '../classNavigation';
import { percent } from '../labels';
import { practicePath } from '../components/AssignmentAnalysis';
import { MasteryEstimate, PracticeRecords, homeworkRate } from '../components/ClassLearningDetail';
import { LevelTag, Performance, PERFORMANCE_NOTE, levelRank } from '../components/Performance';
import ClassScoreHistory from '../components/ClassScoreHistory';
import type { ClassStatistics, TeacherClassDetail } from '../types';

const VIEWS = { knowledge: '知识点明细', practice: '学习记录', history: '历次成绩' } as const;
type StudentView = keyof typeof VIEWS;

/** A student's analysis lives in the full right-hand workspace, with a durable URL. */
export default function StudentLearningPage() {
  const { classId = '', studentId = '' } = useParams();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const context = studentReturnContext(classId, location.state);
  const setViewParams = (next: Record<string, string>) => setParams(next, { state: context });
  const requestKey = `${classId}:${studentId}`;
  const [result, setResult] = useState<{ key: string; detail: TeacherClassDetail; statistics?: ClassStatistics } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [chapter, setChapter] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const requested = params.get('view');
  const view: StudentView = requested === 'practice' || requested === 'history' ? requested : 'knowledge';
  const kpId = params.get('kp') ?? undefined;

  useEffect(() => {
    let active = true;
    setFailure(null); setSearch(''); setChapter('');
    // Only this student's statistics: the whole class is not computed to show one person.
    Promise.all([api.classDetail(classId), api.studentStatistics(classId, studentId)]).then(([detail, statistics]) => {
      if (active) setResult({ key: requestKey, detail, statistics });
    }).catch((err) => active && setFailure({ key: requestKey, message: err instanceof Error ? err.message : '加载失败' }));
    return () => { active = false; };
  }, [classId, studentId, requestKey, attempt]);

  useEffect(() => {
    if (result?.key === requestKey) heading.current?.focus();
  }, [result, requestKey]);

  const back = <Link className="back-link" to={context.returnTo} state={{ classFilters: context.classFilters }}>← 返回班级统计</Link>;
  if (failure?.key === requestKey) return <section>{back}<p className="error" role="alert">{failure.message}</p><button onClick={() => setAttempt((n) => n + 1)}>重新加载</button></section>;
  if (result?.key !== requestKey) return <p className="muted" role="status">正在加载学生学情…</p>;
  const { detail, statistics } = result;
  if (!statistics) return <section>{back}<p className="muted">学生统计数据暂不可用。</p><button onClick={() => setAttempt((n) => n + 1)}>重新加载</button></section>;
  const student = statistics.students.find((s) => s.student_id === studentId);
  // A URL alone never grants access to a student outside the owned class's returned cohort.
  if (!student) return <section>{back}<p className="error" role="alert">该学生不在当前班级，无法查看学情。</p></section>;
  const mine = (p: (typeof statistics.knowledge_points)[number]) => p.students.find((s) => s.student_id === studentId)!;
  const points = statistics.knowledge_points.filter((p) => p.students.some((s) => s.student_id === studentId))
    .sort((a, b) => levelRank(mine(a).level) - levelRank(mine(b).level) || (mine(a).score ?? 2) - (mine(b).score ?? 2)
      || chapterRank(a.chapter ?? '') - chapterRank(b.chapter ?? '') || a.kp_name.localeCompare(b.kp_name, 'zh-CN'));
  const weakKps = points.filter((p) => mine(p).level === 'weak' || mine(p).level === 'developing');
  const days = statistics.summary.recent_days ?? 7;
  const chapters = [...new Set(points.map((p) => p.chapter).filter((c): c is string => Boolean(c)))];
  const shown = points.filter((p) => (!chapter || p.chapter === chapter)
    && `${p.kp_name} ${p.chapter ?? ''} ${p.section ?? ''}`.includes(search.trim()));
  const selectedPoint = kpId ? points.find((p) => p.kp_id === kpId) : undefined;

  return <section className="class-statistics student-learning-page">
    {back}
    <header className="student-learning-head">
      <div><h1 ref={heading} tabIndex={-1}>{student.display_name} 的学情</h1><p className="muted">{detail.name} · 学号 {student.student_number ?? '未设置'} · {student.knowledge_count} 个知识点有数据</p></div>
      <Link className="secondary-link" to={practicePath(classId, [studentId], weakKps.map((p) => p.kp_id))}>为该学生补练</Link>
    </header>
    <div className="student-learning-summary" aria-label="学生学习概况">
      <span>表现 <Performance score={student.score} evidence={student.evidence} level={student.level} /> <LevelTag level={student.level} /></span>
      <span>近 {days} 天练习 <strong>{student.recent_practice_count ?? 0}</strong> 题次</span>
      <span>作业已交 <strong>{student.homework_submitted} / {student.homework_expected}</strong>{student.homework_missed ? <span className="student-no-data">缺交 {student.homework_missed} 份</span> : null}</span>
      <span title="已发布作业的总得分 / 总满分">作业得分率 <strong>{student.homework_rate == null ? '—' : percent(student.homework_rate)}</strong></span>
      <span>最近学习 <strong>{student.latest_activity_at ? new Date(student.latest_activity_at).toLocaleDateString('zh-CN') : '暂无记录'}</strong></span>
    </div>
    <div className="card student-conclusion" aria-label="学情结论">
      {/* Weak knowledge points have their own column; here only the other reasons. */}
      <div><h2>需要关注</h2>{student.attention?.some((r) => r.code !== 'weak') ? <ul>{student.attention.filter((r) => r.code !== 'weak').map((r) => <li key={r.code}>{r.text}</li>)}</ul> : <p className="muted">暂无其他需要特别关注的地方。</p>}</div>
      <div><h2>薄弱知识点</h2>{student.weak_points?.length ? <ul>{student.weak_points.map((p) => <li key={p.kp_id}><button type="button" className="link-button" onClick={() => setViewParams({ view: 'practice', kp: p.kp_id })}>{p.kp_name}</button> <span className="muted small">{percent(p.score)}</span></li>)}</ul> : <p className="muted">{(student.evidence ?? 0) < 3 ? '数据还不够判断。' : '没有明显薄弱的知识点。'}</p>}</div>
      <div><h2>掌握较好</h2>{student.strong_points?.length ? <ul>{student.strong_points.map((p) => <li key={p.kp_id}>{p.kp_name} <span className="muted small">{percent(p.score)}</span></li>)}</ul> : <p className="muted">暂无。</p>}</div>
    </div>
    <nav className="tabs class-stat-views" aria-label="学生分析视图">
      {Object.entries(VIEWS).map(([key, label]) => <button type="button" key={key} className={view === key ? 'active' : ''}
        aria-current={view === key ? 'page' : undefined} onClick={() => setViewParams({ view: key })}>{label}</button>)}
    </nav>
    {view === 'knowledge' && <div className="card class-stat-card student-knowledge-card">
      <div className="class-stat-card-head"><div><h2>知识点明细</h2><p className="muted small">薄弱的知识点排在前面；点击知识点查看对应的作答记录。</p></div><span className="muted small">{shown.length} 个知识点</span></div>
      <div className="class-stat-filters"><input type="search" aria-label="搜索学生知识点" placeholder="搜索知识点或章节" value={search} onChange={(e) => setSearch(e.target.value)} /><select aria-label="学生知识点章节" value={chapter} onChange={(e) => setChapter(e.target.value)}><option value="">全部章节</option>{chapters.map((c) => <option key={c}>{c}</option>)}</select></div>
      <div className="table-scroll"><table aria-label="学生知识点明细"><thead><tr><th>知识点</th><th>所属章节</th><th>表现</th><th>状态</th><th>练习题次</th><th>作业得分率</th><th>系统掌握度估计</th></tr></thead><tbody>{shown.map((p) => {
        const e = mine(p);
        return <tr key={p.kp_id}><td><button className="link-button" onClick={() => setViewParams({ view: 'practice', kp: p.kp_id })}>{p.kp_name}</button></td><td className="class-stat-chapter">{p.chapter ?? '—'}{p.section && <span className="student-no-data">{p.section}</span>}</td><td><Performance score={e.score} evidence={e.evidence} level={e.level} /></td><td><LevelTag level={e.level} /></td><td>{e.practice_count || '—'}</td><td>{homeworkRate(e)}</td><td className="muted"><MasteryEstimate evidence={e} /></td></tr>;
      })}</tbody></table></div>
      {!shown.length && <p className="class-stat-empty">{points.length ? '没有符合条件的知识点。' : '暂无知识点学习记录。'}</p>}
      <details className="class-estimate"><summary>系统掌握度估计 {student.mastery == null ? '暂无数据' : percent(student.mastery)}</summary><p className="muted small">与学生 App 共用知识点掌握数据，结合自主练习及老师已发布的作业证据，供教学参考，不等同于正确率或考试成绩。暂无记录的知识点不作为零分。</p></details>
      <p className="class-stat-footnote">{PERFORMANCE_NOTE}作业得分率 = 该知识点已发布作业的总得分 / 总满分。</p>
    </div>}
    {view === 'practice' && <div className="card class-stat-card student-practice-card">
      {kpId && <div className="student-practice-scope"><span>{selectedPoint ? `当前知识点：${selectedPoint.kp_name}` : '该知识点暂无当前学生的学习记录。'}</span><button onClick={() => setViewParams({ view: 'practice' })}>查看该生全部练习</button></div>}
      {(!kpId || selectedPoint) && <PracticeRecords key={`${studentId}:${kpId ?? ''}`} classId={classId} studentId={studentId} kpId={kpId} headingLevel={2} />}
    </div>}
    {view === 'history' && <ClassScoreHistory key={`${classId}:${studentId}`} classId={classId} studentId={studentId} />}
  </section>;
}
