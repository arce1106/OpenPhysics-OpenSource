import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatPoints, percent, typeLabel } from '../labels';
import type { AssignmentDetail, Report, ReviewEntry } from '../types';
import type { AnalysisTab } from './AssignmentWorkspace';
import Modal, { ImageViewer } from './Modal';
import { QuestionBody, QuestionMeta } from './QuestionBrowser';
import RichText from './RichText';

type ReportStudent = Report['students'][number];
type Drill = { kind: 'student'; id: string } | { kind: 'question'; number: number; studentId?: string; answer?: string; error?: string };

export function practicePath(classId: string, studentIds: string[], kpIds: string[]) {
  const query = new URLSearchParams({ mode: 'personalized', for: classId });
  [...new Set(studentIds)].forEach((id) => query.append('student', id));
  [...new Set(kpIds)].forEach((id) => query.append('kp', id));
  return `/?${query}`;
}

// Mirrors the backend bands, for reports generated before each student carried its band.
const BAND_FLOORS: Array<[number, string]> = [[90, '90–100%'], [80, '80–89%'], [70, '70–79%'], [60, '60–69%'], [0, '60% 以下']];
function bandOf(student: ReportStudent) {
  if (student.band) return student.band;
  if (student.percent == null) return null;
  return BAND_FLOORS.find(([floor]) => student.percent! >= floor)?.[1] ?? null;
}

function lost(item: NonNullable<ReportStudent['items']>[number]) {
  return item.score != null && item.max_score != null && item.score < item.max_score;
}

export default function AssignmentAnalysis({ detail, report, tab, onTab }: {
  detail: AssignmentDetail; report: Report; tab: AnalysisTab; onTab: (tab: AnalysisTab) => void;
}) {
  const [drill, setDrill] = useState<Drill | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState('all');
  const [questionFilter, setQuestionFilter] = useState('all');
  const [band, setBand] = useState<string | null>(null);
  const [cohort, setCohort] = useState<{ title: string; ids: string[]; kps: string[] } | null>(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const personalized = detail.kind === 'personalized';
  const qByNumber = useMemo(() => new Map(report.questions.map((q) => [q.number, q])), [report]);
  const studentById = useMemo(() => new Map(report.students.map((s) => [s.student_id, s])), [report]);
  const visibleStudents = report.students.filter((s) => (
    `${s.student_number ?? ''} ${s.display_name}`.toLowerCase().includes(search.toLowerCase())
    && (studentFilter === 'all' || (studentFilter === 'missing' ? !s.submitted : s.submitted && ((s.percent ?? 100) < 60 || (s.repeated_errors ?? []).length > 0)))
  ));
  const visibleQuestions = report.questions.filter((q) => questionFilter !== 'low' || (q.rate != null && q.rate < 0.6));
  const kpGroups = useMemo(() => {
    const groups = new Map<string, { name: string; kpId: string | null; earned: number; full: number; ids: Set<string>; count: number }>();
    report.questions.forEach((q) => {
      const key = q.kp_id ?? q.kp_name ?? 'unmapped';
      const group = groups.get(key) ?? { name: q.kp_name ?? '未标注知识点', kpId: q.kp_id ?? null, earned: 0, full: 0, ids: new Set<string>(), count: 0 };
      report.students.forEach((s) => (s.items ?? []).filter((i) => i.analysis_number === q.number).forEach((i) => {
        if (i.score == null || i.max_score == null) return;
        group.earned += i.score;
        group.full += i.max_score;
        group.count += 1;
        if (lost(i)) group.ids.add(s.student_id);
      }));
      groups.set(key, group);
    });
    return [...groups.values()];
  }, [report]);
  const pickedKps = [...new Set(report.students.filter((s) => selected.has(s.student_id)).flatMap((s) =>
    (s.items ?? []).filter(lost).map((i) => qByNumber.get(i.analysis_number ?? -1)?.kp_id).filter((id): id is string => Boolean(id))))];

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function download() {
    setDownloading(true); setError('');
    try {
      const url = URL.createObjectURL(await api.reportCsv(detail.id));
      const link = document.createElement('a'); link.href = url; link.download = `${detail.title}-成绩.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { setError(err instanceof Error ? err.message : '导出失败'); }
    finally { setDownloading(false); }
  }
  const bandMax = Math.max(1, ...report.bands.map((b) => b.count));
  // Lowest first: the students a teacher looks at first are at the bottom of the band.
  const bandStudents = band ? report.students.filter((s) => s.submitted && bandOf(s) === band)
    .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0)) : [];
  const lostKps = (students: ReportStudent[]) => [...new Set(students.flatMap((s) =>
    (s.items ?? []).filter(lost).map((i) => qByNumber.get(i.analysis_number ?? -1)?.kp_id).filter((id): id is string => Boolean(id))))];
  const positions = report.positions ?? report.questions.map((q) => q.number);
  return <>
    <div className="analysis-toolbar">
      <span className="muted small">已发布结果 · {report.collected} / {report.class_size} 人计入统计{(report.late ?? 0) > 0 && ` · ${report.late} 份迟交未计入`}</span>
      <button type="button" disabled={downloading} onClick={download}>{downloading ? '正在导出…' : '导出成绩 CSV'}</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {selected.size > 0 && <div className="workspace-selection" role="region" aria-label="补练对象">
      <span>已选 {selected.size} 名学生</span>
      {detail.class_id && <Link className="primary-link" to={practicePath(detail.class_id, [...selected], pickedKps)}>为所选学生出个性化作业</Link>}
      <button onClick={() => setSelected(new Set())}>清空选择</button>
      <span className="muted small">{pickedKps.length ? `带入 ${pickedKps.length} 个失分知识点，进入组卷后确认。` : '进入组卷后选择补练范围。'}</span>
    </div>}
    {tab === 'overview' && <>
      <div className="metrics four">
        <Stat label="已计入 / 应交" value={`${report.collected} / ${report.class_size}`} />
        <Stat label={personalized ? '平均得分率' : '平均分'} value={report.collected ? personalized ? percent(report.average_rate ?? 0) : formatPoints(report.average) : '—'} />
        <Stat label="未计入成绩" value={String(report.students.filter((s) => !s.submitted).length)} />
        <Stat label="主要已确认错因" value={report.errors[0]?.name ?? '—'} />
      </div>
      {personalized && <p className="muted small">每人题目和满分不同，按得分率观察完成效果；逐题分析按实际题目汇总，不按卷面位置横向比较。</p>}
      <div className="columns">
        <section className="card"><h2>得分率分布</h2><p className="muted small">点击分数段查看对应学生。</p><ul className="bars">{report.bands.map((b) => <li key={b.label}><button type="button" className={`band-row${band === b.label ? ' active' : ''}`} aria-pressed={band === b.label} disabled={!b.count} onClick={() => setBand(band === b.label ? null : b.label)}><span>{b.label}</span><span className="bar"><span style={{ width: `${b.count / bandMax * 100}%` }} /></span><span>{b.count} 人</span></button></li>)}</ul>
          {band && <div className="band-students" role="region" aria-label={`${band} 的学生`}>
            <div className="card-head"><strong>{band} · {bandStudents.length} 名学生</strong><button type="button" onClick={() => setBand(null)}>收起</button></div>
            <div className="distribution-chips">{bandStudents.map((s) => <button key={s.student_id} type="button" onClick={() => setDrill({ kind: 'student', id: s.student_id })}>{s.display_name}<span className="muted"> {s.percent}%</span></button>)}</div>
            {bandStudents.length > 0 && <div className="paper-actions"><button type="button" onClick={() => setSelected((current) => new Set([...current, ...bandStudents.map((s) => s.student_id)]))}>加入补练选择</button>{detail.class_id && <Link className="primary-link" to={practicePath(detail.class_id, bandStudents.map((s) => s.student_id), lostKps(bandStudents))}>为这 {bandStudents.length} 名学生补练</Link>}</div>}
          </div>}
        </section>
        <section className="card"><h2>教学关注</h2><p>{report.questions.filter((q) => q.rate != null && q.rate < 0.6).length} 道题得分率低于 60%。</p><div className="paper-actions"><button onClick={() => { setQuestionFilter('low'); onTab('questions'); }}>查看失分题目</button><button onClick={() => { setStudentFilter('attention'); onTab('students'); }}>查看需关注学生</button><button onClick={() => { setStudentFilter('missing'); onTab('students'); }}>查看未计入学生</button></div><p className="muted small">缺交与迟交单独展示，不作为零分参加均分。关注学生按得分率低于 60% 或重复错因筛选。</p></section>
      </div>
      {report.same_error && <section className="card"><h2>同错因再错率</h2>{report.same_error.questions ? <><p>{report.same_error.questions} 道针对既往错因的变式作答中，{report.same_error.missed_again} 道失分；老师确认同一错因再犯 {report.same_error.same_cause_again ?? 0} 道（{report.same_error.same_cause_rate == null ? '证据不足' : percent(report.same_error.same_cause_rate)}）。</p><p className="muted small">可比较错因的作答 {report.same_error.comparable ?? report.same_error.questions} 道，归因不明 {report.same_error.unknown ?? 0} 道；归因不明不作为已改善。</p><ul className="rows">{report.same_error.by_error.map((e) => <li key={e.error_type}>{e.name}<span>{e.same_cause_again ?? 0} / {e.comparable ?? e.questions} 道同错因再犯 · {e.missed_again} 道失分</span></li>)}</ul></> : <p className="muted">本次暂无已收的同错因变式题。</p>}</section>}
    </>}
    {tab === 'students' && <section className="card table-card"><h2>学生与成绩</h2><div className="analysis-filters"><input aria-label="搜索学生" placeholder="姓名或学号" value={search} onChange={(e) => setSearch(e.target.value)} /><select aria-label="筛选学生状态" value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)}><option value="all">全部参与学生</option><option value="attention">需要关注</option><option value="missing">缺交 / 迟交未计入</option></select><button disabled={!visibleStudents.length} onClick={() => setSelected(new Set(visibleStudents.map((s) => s.student_id)))}>选择筛选结果</button></div>
      <p className="muted small">点击学生姓名查看逐题成绩和原始作答。{personalized ? '题号列为学生自己的卷面位置，每个人对应的题目可能不同。' : '点击分数可直接查看该题作答。'}“—”表示该题无评分记录，0 分是已评分。</p>
      <div className="table-scroll"><table aria-label="学生成绩"><thead><tr><th>选择</th><th>学号</th><th>学生</th><th>状态</th><th>得分 / 满分</th><th>得分率</th>{positions.map((n) => <th key={n}>第 {n} 题</th>)}</tr></thead><tbody>{visibleStudents.map((s) => <tr key={s.student_id}><td><input type="checkbox" aria-label={`选择 ${s.display_name}`} checked={selected.has(s.student_id)} onChange={() => toggle(s.student_id)} /></td><td>{s.student_number ?? '—'}</td><td><button className="link-button" onClick={() => setDrill({ kind: 'student', id: s.student_id })}>{s.display_name}</button></td><td>{s.submitted ? '已发布' : s.late ? '迟交 · 未计入' : '缺交'}</td><td>{s.submitted ? `${formatPoints(s.total ?? 0)} / ${formatPoints(s.full_points ?? report.total_points ?? 0)}` : '—'}</td><td>{s.submitted && s.percent != null ? `${s.percent}%` : '—'}</td>{positions.map((n) => {
        const item = s.items?.find((i) => i.number === n);
        const score = item?.score ?? s.scores?.[String(n)];
        const number = item?.analysis_number ?? (!personalized ? n : null);
        return <td key={n}>{s.submitted && score != null ? number != null ? <button className={`score-link ${item && lost(item) ? 'wrong' : ''}`} aria-label={`${s.display_name} 第 ${n} 题 ${formatPoints(score)} 分`} onClick={() => setDrill({ kind: 'question', number, studentId: s.student_id })}>{formatPoints(score)}{personalized && item?.max_score != null ? ` / ${formatPoints(item.max_score)}` : ''}</button> : formatPoints(score) : '—'}</td>;
      })}</tr>)}</tbody></table></div>{!visibleStudents.length && <p className="muted">没有符合条件的学生。</p>}
    </section>}
    {tab === 'questions' && <section className="card table-card"><div className="card-head"><h2>逐题分析</h2><select aria-label="筛选题目" value={questionFilter} onChange={(e) => setQuestionFilter(e.target.value)}><option value="all">全部题目</option><option value="low">得分率低于 60%</option></select></div><p className="muted small">点击题目查看原题、对应学生和作答；点击选项分布可筛选选择该答案的学生。{personalized && '分析编号按实际题目汇总，参与人数随题目变化。'}</p>
      <div className="table-scroll"><table aria-label="逐题分析"><thead><tr><th>{personalized ? '分析编号' : '题号'}</th><th>题目 / 知识点</th><th>作答人数</th><th>得分率</th><th>选项分布 / 各问得分率</th><th>已确认错因</th></tr></thead><tbody>{visibleQuestions.map((q) => <tr key={q.number}><td><button className="link-button" onClick={() => setDrill({ kind: 'question', number: q.number })}>{q.number}</button></td><td className="question-cell"><button className="link-button" onClick={() => setDrill({ kind: 'question', number: q.number })}>{typeLabel(q.question_type)} · {q.kp_name ?? '未标注知识点'}</button><span className="muted small">{q.stem_preview}</span></td><td>{q.students ?? '—'}</td><td className={q.rate != null && q.rate < 0.6 ? 'wrong' : ''}>{q.rate == null ? '—' : percent(q.rate)}</td><td>{q.distribution ? <div className="distribution-chips">{Object.entries(q.distribution).map(([answer, count]) => <button key={answer} onClick={() => setDrill({ kind: 'question', number: q.number, answer })}>{answer}{answer === q.answer ? ' ✓' : ''} · {count} 人</button>)}</div> : q.parts.map((p) => `${p.label} ${p.rate == null ? '—' : percent(p.rate)}`).join('；') || '—'}</td><td>{q.errors.length ? q.errors.map((e) => <button key={e.error_type} className="link-button" onClick={() => setDrill({ kind: 'question', number: q.number, error: e.error_type })}>{e.name} {e.count} 人</button>) : '—'}</td></tr>)}</tbody></table></div>{!visibleQuestions.length && <p className="muted">没有符合条件的题目。</p>}
    </section>}
    {tab === 'knowledge' && <>
      <p className="workspace-notice">以下是本次作业表现；知识点得分率按已评分作答的总得分 / 总满分计算，不能直接等同于长期掌握度。错因只统计已确认的失分作答。</p>
      <section className="card table-card"><h2>本次知识点表现</h2><div className="table-scroll"><table aria-label="知识点表现"><thead><tr><th>知识点</th><th>已评分作答</th><th>得分率</th><th>失分学生</th></tr></thead><tbody>{kpGroups.map((g) => <tr key={g.kpId ?? g.name}><td>{g.name}</td><td>{g.count}</td><td>{g.full ? percent(g.earned / g.full) : '—'}</td><td><button disabled={!g.ids.size} onClick={() => setCohort({ title: `${g.name} · 失分学生`, ids: [...g.ids], kps: g.kpId ? [g.kpId] : [] })}>{g.ids.size} 人 · 查看</button></td></tr>)}</tbody></table></div></section>
      <section className="card"><h2>已确认错因</h2>{report.errors.length ? <ul className="rows">{report.errors.map((e) => {
        const affected = report.students.filter((s) => s.items?.some((i) => lost(i) && i.error_type === e.error_type));
        const kps = [...new Set(affected.flatMap((s) => (s.items ?? []).filter((i) => lost(i) && i.error_type === e.error_type).map((i) => qByNumber.get(i.analysis_number ?? -1)?.kp_id).filter((id): id is string => Boolean(id))))];
        return <li key={e.error_type}><strong>{e.name}</strong><span>{e.count} 次失分作答</span><button disabled={!affected.length} onClick={() => setCohort({ title: e.name, ids: affected.map((s) => s.student_id), kps })}>查看 {affected.length} 名学生</button></li>;
      })}</ul> : <p className="muted">暂无已确认的失分错因。选择题的错误选项可在逐题分析中查看。</p>}</section>
      {cohort && <section className="card" aria-label="关联学生"><div className="card-head"><h2>{cohort.title}</h2><button onClick={() => setCohort(null)}>收起</button></div><div className="distribution-chips">{cohort.ids.map((id) => <button key={id} onClick={() => setDrill({ kind: 'student', id })}>{studentById.get(id)?.display_name}</button>)}</div>{detail.class_id && <Link className="primary-link" to={practicePath(detail.class_id, cohort.ids, cohort.kps)}>为这 {cohort.ids.length} 名学生补练</Link>}</section>}
    </>}
    {drill?.kind === 'student' && (() => {
      const student = studentById.get(drill.id);
      if (!student) return null;
      const kps = [...new Set((student.items ?? []).filter(lost).map((i) => qByNumber.get(i.analysis_number ?? -1)?.kp_id).filter((id): id is string => Boolean(id)))];
      return <Modal label={`${student.display_name} 的作业`} onClose={() => setDrill(null)} className="analysis-dialog"><div className="card-head"><h2>{student.display_name} 的作业</h2><button onClick={() => setDrill(null)}>关闭</button></div>{!student.submitted ? <p>{student.late ? '迟交作答未计入本次已发布成绩。' : '尚未提交，未记为零分。'}</p> : <><p>得分 {formatPoints(student.total ?? 0)} / {formatPoints(student.full_points ?? 0)} · 得分率 {student.percent}%</p><table aria-label="学生逐题成绩"><thead><tr><th>卷面题号</th><th>知识点</th><th>得分 / 满分</th><th>错因</th><th>原始作答</th></tr></thead><tbody>{(student.items ?? []).map((i) => <tr key={i.number}><td>{i.number}</td><td>{qByNumber.get(i.analysis_number ?? -1)?.kp_name ?? '—'}</td><td>{i.score == null ? '未评分' : formatPoints(i.score)} / {i.max_score == null ? '—' : formatPoints(i.max_score)}</td><td>{lost(i) ? i.error_type_name ?? '未归因' : '—'}</td><td><button disabled={i.analysis_number == null} onClick={() => setDrill({ kind: 'question', number: i.analysis_number!, studentId: student.student_id })}>查看作答</button></td></tr>)}</tbody></table></>}{detail.class_id && <Link className="primary-link" to={practicePath(detail.class_id, [student.student_id], kps)}>给该学生出个性化作业</Link>}</Modal>;
    })()}
    {drill?.kind === 'question' && <QuestionDrill key={`${drill.number}-${drill.studentId ?? ''}-${drill.answer ?? ''}-${drill.error ?? ''}`} detail={detail} report={report} drill={drill} onClose={() => setDrill(null)} />}
  </>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="card metric"><span className="muted">{label}</span><strong className={value.length > 10 ? 'metric-text' : ''}>{value}</strong></div>;
}

function QuestionDrill({ detail, report, drill, onClose }: {
  detail: AssignmentDetail; report: Report; drill: Extract<Drill, { kind: 'question' }>; onClose: () => void;
}) {
  const [entries, setEntries] = useState<ReviewEntry[] | null>(null);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState(drill.answer ?? '');
  const [filter, setFilter] = useState(drill.error ? `error:${drill.error}` : 'all');
  const [image, setImage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const q = report.questions.find((item) => item.number === drill.number);
  const question = [...detail.items, ...(detail.papers ?? []).flatMap((p) => p.items)].find((i) => i.question_id === q?.question_id)?.question;
  useEffect(() => {
    let live = true;
    setEntries(null); setError('');
    api.reviewQuestion(detail.id, drill.number).then((next) => {
      if (!live) return;
      const official = new Set(report.students.filter((s) => s.submitted).map((s) => s.student_id));
      setEntries(next.filter((e) => official.has(e.student_id)));
    }).catch((err) => live && setError(err instanceof Error ? err.message : '作答加载失败'));
    return () => { live = false; };
  }, [detail.id, drill.number, report, attempt]);
  const visible = (entries ?? []).filter((e) => (!drill.studentId || e.student_id === drill.studentId)
    && (!answer || (e.answer || '未作答') === answer)
    && (filter === 'all' || (filter === 'lost' ? e.score != null && e.max_score != null && e.score < e.max_score : e.error_type === filter.slice(6))));
  const targets = visible.filter((e) => e.score != null && e.max_score != null && e.score < e.max_score).map((e) => e.student_id);
  const errors = [...new Map((entries ?? []).filter((e) => e.error_type && e.error_type !== 'none' && e.error_type !== 'unknown').map((e) => [e.error_type!, e.error_type_name])).entries()];
  if (image) return <ImageViewer src={image} alt="原始作答大图" onClose={() => setImage(null)} />;
  return <Modal label={`第 ${drill.number} 题分析`} onClose={onClose} className="analysis-dialog"><div className="card-head"><h2>{detail.kind === 'personalized' ? '分析题目' : '第'} {drill.number} {detail.kind === 'personalized' ? '' : '题'}</h2><button onClick={onClose}>关闭</button></div>
    {question ? <div className="analysis-question"><QuestionMeta question={question} showHistory={false} /><QuestionBody question={question} /><div className="answer">参考答案：<RichText text={question.answer ?? '未提供'} imagePaths={question.image_paths} /></div></div> : <p>{q?.stem_preview ?? '原题快照暂不可用'}</p>}
    <div className="analysis-filters">{q?.distribution && <select aria-label="按作答选项筛选" value={answer} onChange={(e) => setAnswer(e.target.value)}><option value="">全部答案</option>{Object.entries(q.distribution).map(([value, count]) => <option key={value} value={value}>{value} · {count} 人</option>)}</select>}<select aria-label="按得分与错因筛选" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部作答</option><option value="lost">失分作答</option>{errors.map(([key, name]) => <option key={key} value={`error:${key}`}>{name}</option>)}</select><span>{visible.length} 名学生</span>
      {targets.length > 0 && detail.class_id && <Link className="primary-link" to={practicePath(detail.class_id, targets, q?.kp_id ? [q.kp_id] : [])}>给这 {targets.length} 名失分学生补练</Link>}
    </div>
    {error ? <p className="error" role="alert">{error} <button onClick={() => setAttempt((n) => n + 1)}>重试</button></p> : entries === null ? <p role="status">正在加载原始作答…</p> : visible.length === 0 ? <p className="muted">没有符合条件的已发布作答。</p> : <ul className="analysis-answers">{visible.map((e) => <li key={e.item_id} className="card"><div className="card-head"><strong>{e.student_number ?? '—'} · {e.display_name}</strong><span>{e.score == null ? '未评分' : `${formatPoints(e.score)} / ${formatPoints(e.max_score ?? 0)} 分`}</span></div>
      {e.answer ? <div>学生作答：<RichText text={e.answer} /></div> : q?.distribution ? <p className="muted">未作答</p> : null}
      {e.image_url ? <button className="answer-image-button" onClick={() => setImage(e.image_url)}><img src={e.image_url} alt={`${e.display_name} 的原始作答`} /></button> : (e.page_urls ?? []).length ? <div className="distribution-chips">{e.page_urls?.map((url, index) => <button key={url} onClick={() => setImage(url)}>查看原卷第 {index + 1} 页</button>)}</div> : !e.answer && !q?.distribution ? <p className="muted">暂无原始作答图片或文本。</p> : null}
      {e.part_scores?.length ? <ul className="rows">{e.part_scores.map((p) => <li key={p.label}>{p.label} · {formatPoints(p.score)} / {formatPoints(p.points)}<RichText text={p.reason} /></li>)}</ul> : null}
      {e.error_type && !['none', 'unknown'].includes(e.error_type) && e.score != null && e.max_score != null && e.score < e.max_score && <p>已确认错因：{e.error_type_name}</p>}
      {e.first_error && <RichText text={e.first_error} />}{e.feedback && <RichText text={e.feedback} />}{e.teacher_comment && <p>老师评语：{e.teacher_comment}</p>}
      <Link to={`/assignments/${detail.id}/review?question=${drill.number}&student=${encodeURIComponent(e.student_id)}&filter=all`}>查看审核记录</Link>
    </li>)}</ul>}
  </Modal>;
}
