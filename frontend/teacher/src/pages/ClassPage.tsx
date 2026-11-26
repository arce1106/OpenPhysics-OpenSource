import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import ClassScoreHistory from '../components/ClassScoreHistory';
import { ClassHeader } from '../components/ClassNav';
import ClassLearningDetail from '../components/ClassLearningDetail';
import { practicePath } from '../components/AssignmentAnalysis';
import { LEVEL_LABELS, LevelTag, Performance, PERFORMANCE_NOTE, levelRank } from '../components/Performance';
import { studentLearningPath, type ClassListFilters, type StudentNavigationState } from '../classNavigation';
import { percent } from '../labels';
import type { ClassDashboard, ClassKnowledgeStatistics, ClassStatistics, ClassStudentStatistics, PerformanceLevel, TeacherClassDetail } from '../types';

const VIEWS = { overview: '本周概览', students: '学生', knowledge: '知识点', history: '历次成绩' } as const;
type View = keyof typeof VIEWS;
const ATTENTION_ORDER = { missed: 0, low: 1, weak: 2, inactive: 3 } as const;

export default function ClassPage() {
  const { classId = '' } = useParams();
  const location = useLocation();
  const savedFilters = (location.state as { classFilters?: Partial<ClassListFilters> } | null)?.classFilters;
  const [params, setParams] = useSearchParams();
  const requested = params.get('view') ?? 'overview';
  const view: View = requested in VIEWS ? requested as View : 'overview';
  const [detail, setDetail] = useState<TeacherClassDetail | null>(null);
  const [dashboard, setDashboard] = useState<ClassDashboard | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('attention');
  const [chapter, setChapter] = useState('');
  const [pointSort, setPointSort] = useState('weak');
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDetail(null); setDashboard(null); setError(''); setSelection(null);
    setSearch(savedFilters?.search ?? ''); setStatus(savedFilters?.status ?? 'all');
    setSort(savedFilters?.sort ?? 'attention'); setChapter(savedFilters?.chapter ?? '');
    // An archived class no longer shares current learning; its roster and released scores stay.
    api.classDetail(classId)
      .then(async (nextDetail) => [nextDetail, nextDetail.archived ? { statistics: undefined } : await api.classDashboard(classId)] as const)
      .then(([nextDetail, nextDashboard]) => {
        if (active) { setDetail(nextDetail); setDashboard(nextDashboard); }
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : '加载失败'));
    return () => { active = false; };
  }, [classId, attempt]);

  const studentNavigation: StudentNavigationState = {
    returnTo: `${location.pathname}${location.search}`,
    classFilters: { search, status, sort, chapter },
  };
  const statistics = dashboard?.statistics;
  const students = useMemo(() => {
    const words = search.trim().toLowerCase();
    const rows = (statistics?.students ?? []).filter((s) => `${s.student_number ?? ''} ${s.display_name}`.toLowerCase().includes(words)
      && (status === 'all' || (status === 'attention' ? needsAttention(s) : status === 'data' ? hasData(s) : !hasData(s))));
    return rows.sort((a, b) => {
      if (sort === 'attention') return byAttention(a, b) || byNumber(a, b);
      if (sort === 'score') return (a.score ?? 2) - (b.score ?? 2) || byNumber(a, b);
      if (sort === 'practice' || sort === 'recent-count') return (b.recent_practice_count ?? 0) - (a.recent_practice_count ?? 0) || b.practice_count - a.practice_count || byNumber(a, b);
      if (sort === 'recent') return (b.latest_activity_at ?? '').localeCompare(a.latest_activity_at ?? '') || byNumber(a, b);
      return byNumber(a, b);
    });
  }, [statistics, search, status, sort]);
  const points = statistics?.knowledge_points ?? [];
  const chapters = [...new Set(points.map((p) => p.chapter).filter((c): c is string => Boolean(c)))];
  const shownPoints = points.filter((p) => (!chapter || p.chapter === chapter)
    && `${p.kp_name} ${p.chapter ?? ''} ${p.section ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort(pointSort === 'weak' ? byWeakness : (a, b) => (a.chapter ?? '').localeCompare(b.chapter ?? '', 'zh-CN') || a.kp_name.localeCompare(b.kp_name, 'zh-CN'));

  function changeView(next: View) {
    setParams({ view: next }); setSearch(''); setSelection(null);
  }
  if (error) return <section><p className="error" role="alert">{error}</p><button onClick={() => setAttempt((n) => n + 1)}>重新加载</button> <Link to="/classes">返回我的班级</Link></section>;
  if (!detail || !dashboard) return <p className="muted">正在加载班级学情…</p>;
  const days = statistics?.summary.recent_days ?? 7;
  if (detail.archived) return <section className="class-statistics">
    <ClassHeader detail={detail} statisticsOnly />
    <p className="workspace-notice" role="status">这个班级已归档，已停止共享学生当前的学情；名单和已发布的历次成绩仍可查看。</p>
    <ClassScoreHistory key={classId} classId={classId} studentId={params.get('student') ?? undefined} onClearStudent={() => setParams({ view: 'history' })} />
  </section>;

  return <section className="class-statistics">
    <ClassHeader detail={detail} statisticsOnly />
    <nav className="tabs class-stat-views" aria-label="班级统计视图">
      {Object.entries(VIEWS).map(([key, label]) => <button type="button" key={key} aria-current={view === key ? 'page' : undefined}
        className={view === key ? 'active' : ''} onClick={() => changeView(key as View)}>{label}</button>)}
    </nav>
    {statistics && <p className="class-stat-summary" aria-label="数据覆盖">
      <span>近 {days} 天在学 <strong>{statistics.summary.active_students ?? '—'} / {detail.member_count}</strong> 人</span>
      <span>近 {days} 天练习 <strong>{statistics.summary.recent_practice_count ?? '—'}</strong> 题次</span>
      <span>已发布成绩 <strong>{statistics.summary.released_assignments}</strong> 份</span>
      <span className="class-stat-period" title="学生入班以前的自主练习不计入；掌握度为学生账号的整体估计">入班以来的学习记录</span>
    </p>}
    {detail.member_count === 0 ? <div className="card empty"><h2>这个班级还没有学生</h2><p className="muted">加入学生后，这里显示班级统计。</p><Link to={`/classes/${classId}/roster`}>查看名单与学号</Link></div>
      : !statistics ? <div className="card"><p className="muted">统计数据暂不可用，请重新加载。</p><button onClick={() => setAttempt((n) => n + 1)}>重新加载统计</button></div>
      : view === 'overview' ? <Overview classId={classId} statistics={statistics} navigation={studentNavigation}
        onPoint={(id) => setSelection(id)} onAllStudents={() => changeView('students')} onAllPoints={() => changeView('knowledge')} />
      : view === 'students' ? <div className="card class-stat-card">
        <div className="class-stat-card-head"><div><h2>学生</h2><p className="muted small">默认把需要关注的学生排在前面；点击学生查看知识点、学习记录和成绩。</p></div><span className="muted small">{students.length} 名学生</span></div>
        <div className="class-stat-filters">
          <input type="search" aria-label="搜索班级学生" placeholder="搜索姓名或学号" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="学生数据范围" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">全部学生</option><option value="attention">需要关注</option><option value="data">有学习数据</option><option value="empty">暂无数据</option></select>
          <select aria-label="学生统计排序" value={sort} onChange={(e) => setSort(e.target.value)}><option value="attention">需要关注优先</option><option value="number">按学号排序</option><option value="score">表现从低到高</option><option value="practice">近 {days} 天练习最多</option><option value="recent">最近学习优先</option></select>
        </div>
        <div className="table-scroll"><table aria-label="班级学生统计"><thead><tr><th>学号</th><th>学生</th><th>表现</th><th>状态</th><th>近 {days} 天练习</th><th>作业</th><th>需要关注</th><th>详情</th></tr></thead>
          <tbody>{students.map((s) => <tr key={s.student_id}>
            <td>{s.student_number ?? '—'}</td>
            <td><Link className="student-stat-name" to={studentLearningPath(classId, s.student_id)} state={studentNavigation}>{s.display_name}</Link>{!hasData(s) && <span className="student-no-data">暂无数据</span>}</td>
            <td><Performance score={s.score} evidence={s.evidence} level={s.level} /></td>
            <td><LevelTag level={s.level} /></td>
            <td>{s.recent_practice_count ? `${s.recent_practice_count} 题次` : '—'}<span className="student-no-data">最近 {activityDate(s.latest_activity_at)}</span></td>
            <td>{s.homework_expected ? <span>{s.homework_submitted} / {s.homework_expected}<span className="student-no-data">{s.homework_missed ? `缺交 ${s.homework_missed} 份` : '已交 / 应交'}</span></span> : '未布置'}</td>
            <td><AttentionList reasons={s.attention} /></td>
            <td><Link className="secondary-link" to={studentLearningPath(classId, s.student_id)} state={studentNavigation} aria-label={`查看 ${s.display_name} 的学情`}>查看</Link></td>
          </tr>)}</tbody>
        </table></div>{!students.length && <p className="class-stat-empty">没有符合筛选条件的学生。</p>}
        <p className="class-stat-footnote">{PERFORMANCE_NOTE}“缺交”只统计已发布结果的作业；未交、未发布的成绩不记为零分。</p>
      </div>
      : view === 'knowledge' ? <div className="card class-stat-card">
        <div className="class-stat-card-head"><div><h2>知识点</h2><p className="muted small">默认把薄弱的知识点排在前面；点开查看哪些学生需要补练。</p></div><span className="muted small">{shownPoints.length} 个知识点</span></div>
        <div className="class-stat-filters"><input type="search" aria-label="搜索知识点" placeholder="搜索知识点或章节" value={search} onChange={(e) => setSearch(e.target.value)} /><select aria-label="按章节查看知识点" value={chapter} onChange={(e) => setChapter(e.target.value)}><option value="">全部章节</option>{chapters.map((c) => <option key={c}>{c}</option>)}</select><select aria-label="知识点排序" value={pointSort} onChange={(e) => setPointSort(e.target.value)}><option value="weak">薄弱优先</option><option value="chapter">按章节</option></select></div>
        <div className="table-scroll"><table aria-label="班级知识点统计"><thead><tr><th>知识点</th><th>所属章节</th><th>表现</th><th>状态</th><th>薄弱 / 待巩固</th><th>有数据学生</th><th>详情</th></tr></thead><tbody>{shownPoints.map((p) => <tr key={p.kp_id}>
          <td><button className="link-button" onClick={() => setSelection(p.kp_id)}>{p.kp_name}</button></td>
          <td className="class-stat-chapter">{p.chapter ?? '—'}{p.section && <span className="student-no-data">{p.section}</span>}</td>
          <td><Performance score={p.score} evidence={p.evidence} level={p.level} /></td>
          <td><LevelTag level={p.level} /></td>
          <td>{(p.weak_students ?? 0) || (p.developing_students ?? 0) ? `${p.weak_students ?? 0} / ${p.developing_students ?? 0} 人` : '—'}</td>
          <td>{p.student_count} / {detail.member_count} 人</td>
          <td><button aria-label={`查看 ${p.kp_name} 的统计`} onClick={() => setSelection(p.kp_id)}>查看</button></td>
        </tr>)}</tbody></table></div>
        {!shownPoints.length && <p className="class-stat-empty">{points.length ? '没有符合条件的知识点。' : '暂无知识点学习记录。'}</p>}
        <p className="class-stat-footnote">{PERFORMANCE_NOTE}系统掌握度估计在详情中查看。</p>
      </div>
      : <ClassScoreHistory key={classId} classId={classId} studentId={params.get('student') ?? undefined} onClearStudent={() => setParams({ view: 'history' })} />}
    {selection && statistics && <ClassLearningDetail key={classId} classId={classId} statistics={statistics} kpId={selection} navigationState={studentNavigation} onClose={() => setSelection(null)} />}
  </section>;
}

/** The three questions a teacher opens the class for: who needs me, what to go over, how the class stands. */
function Overview({ classId, statistics, navigation, onPoint, onAllStudents, onAllPoints }: {
  classId: string; statistics: ClassStatistics; navigation: StudentNavigationState;
  onPoint: (kpId: string) => void; onAllStudents: () => void; onAllPoints: () => void;
}) {
  const flagged = statistics.students.filter(needsAttention).sort((a, b) => byAttention(a, b) || byNumber(a, b));
  const weak = statistics.knowledge_points.filter((p) => p.level === 'weak' || p.level === 'developing' || (p.weak_students ?? 0) > 0)
    .sort(byWeakness).slice(0, 5);
  const counts = statistics.students.reduce<Record<PerformanceLevel, number>>((sum, s) => {
    sum[s.level ?? 'insufficient'] += 1; return sum;
  }, { weak: 0, developing: 0, mastered: 0, insufficient: 0 });
  const total = statistics.students.length || 1;
  return <div className="class-overview">
    <div className="card class-stat-card overview-attention">
      <div className="class-stat-card-head"><div><h2>需要关注的学生</h2><p className="muted small">缺交作业、得分率偏低、有薄弱知识点或一周没有学习。</p></div><span className="muted small">{flagged.length} 人</span></div>
      {flagged.length ? <ul className="overview-list">{flagged.slice(0, 8).map((s) => <li key={s.student_id}>
        <Link to={studentLearningPath(classId, s.student_id)} state={navigation} className="student-stat-name">{s.student_number ? `${s.student_number} ` : ''}{s.display_name}</Link>
        <AttentionList reasons={s.attention} />
      </li>)}</ul> : <p className="class-stat-empty">目前没有需要特别关注的学生。</p>}
      {flagged.length > 8 && <button type="button" className="link-button" onClick={onAllStudents}>查看全部 {flagged.length} 人</button>}
    </div>
    <div className="card class-stat-card overview-points">
      <div className="class-stat-card-head"><div><h2>值得讲评的知识点</h2><p className="muted small">按薄弱学生人数和表现排序，每个知识点至少 3 道已批改的题才参与判断。</p></div></div>
      {weak.length ? <ul className="overview-list overview-point-list">{weak.map((p) => <li key={p.kp_id}>
        <span className="overview-point-name"><button type="button" className="link-button" onClick={() => onPoint(p.kp_id)}>{p.kp_name}</button><span className="muted small">{p.chapter ?? ''}</span></span>
        <span className="overview-point-figures"><Performance score={p.score} evidence={p.evidence} level={p.level} /><LevelTag level={p.level} />{(p.weak_students ?? 0) > 0 && <span className="muted small">薄弱 {p.weak_students} 人</span>}</span>
        <Link className="link-button" to={practicePath(classId, needing(p), [p.kp_id])}>出个性化作业</Link>
      </li>)}</ul> : <p className="class-stat-empty">还没有足够的数据判断薄弱知识点。</p>}
      {weak.length > 0 && <button type="button" className="link-button" onClick={onAllPoints}>查看全部知识点</button>}
    </div>
    <div className="card class-stat-card overview-levels">
      <div className="class-stat-card-head"><div><h2>班级表现分布</h2><p className="muted small">按每位学生入班以来的整体表现。</p></div></div>
      <div className="level-bar" role="img" aria-label={(Object.keys(counts) as PerformanceLevel[]).map((key) => `${LEVEL_LABELS[key]} ${counts[key]} 人`).join('，')}>
        {(['mastered', 'developing', 'weak', 'insufficient'] as const).map((key) => counts[key] > 0 &&
          <span key={key} className={`level-${key}`} style={{ flexGrow: counts[key] / total }} />)}
      </div>
      <ul className="level-legend">{(['mastered', 'developing', 'weak', 'insufficient'] as const).map((key) => <li key={key}><LevelTag level={key} /> {counts[key]} 人</li>)}</ul>
      <p className="class-stat-footnote">{PERFORMANCE_NOTE}</p>
    </div>
  </div>;
}

function AttentionList({ reasons }: { reasons?: ClassStudentStatistics['attention'] }) {
  if (!reasons?.length) return <span className="muted">—</span>;
  return <span className="attention-list">{reasons.map((r) => <span key={r.code} className={`attention-chip attention-${r.code}`}>{r.text}</span>)}</span>;
}

/** Students in this knowledge point who are weak or not yet secure: the ones to give practice to. */
function needing(point: ClassKnowledgeStatistics) {
  return point.students.filter((s) => s.level === 'weak' || s.level === 'developing').map((s) => s.student_id);
}
export function needsAttention(s: ClassStudentStatistics) { return Boolean(s.attention?.length); }
function attentionWeight(s: ClassStudentStatistics) {
  return Math.min(...(s.attention ?? []).map((r) => ATTENTION_ORDER[r.code] ?? 9), 9);
}
function byAttention(a: ClassStudentStatistics, b: ClassStudentStatistics) {
  return (b.attention?.length ?? 0) - (a.attention?.length ?? 0) || attentionWeight(a) - attentionWeight(b);
}
function byWeakness(a: ClassKnowledgeStatistics, b: ClassKnowledgeStatistics) {
  return levelRank(a.level) - levelRank(b.level) || (b.weak_students ?? 0) - (a.weak_students ?? 0)
    || (a.score ?? 2) - (b.score ?? 2) || b.student_count - a.student_count || a.kp_name.localeCompare(b.kp_name, 'zh-CN');
}

function byNumber(a: ClassStudentStatistics, b: ClassStudentStatistics) {
  return (a.student_number == null ? 1 : 0) - (b.student_number == null ? 1 : 0)
    || Number(a.student_number ?? 0) - Number(b.student_number ?? 0) || a.display_name.localeCompare(b.display_name, 'zh-CN');
}
export function hasData(s: ClassStudentStatistics) { return Boolean(s.practice_count || s.homework_submitted || s.mastery != null); }
export function rate(value: number | null) { return value == null ? '—' : percent(value); }
export function activityDate(value: string | null) { return value ? new Date(value).toLocaleDateString('zh-CN') : '暂无记录'; }
