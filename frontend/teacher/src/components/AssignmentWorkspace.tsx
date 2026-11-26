import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { formatPoints, typeLabel } from '../labels';
import type { AssignmentDetail, ClassAssignment, Collection, Report, ReviewOverview, StudentPaper } from '../types';
import AssignmentSteps from './AssignmentSteps';
import { QuestionBody, QuestionMeta } from './QuestionBrowser';
import RichText from './RichText';
import AssignmentAnalysis from './AssignmentAnalysis';
import DeleteAssignmentDialog from './DeleteAssignmentDialog';

const TABS = { overview: '概览', students: '学生与成绩', questions: '逐题分析', knowledge: '知识点与错因' } as const;
export type AnalysisTab = keyof typeof TABS;

/** The class execution, rather than its source paper, owns every operation and statistic here. */
export default function AssignmentWorkspace({ detail }: { detail: AssignmentDetail }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'overview') as AnalysisTab;
  const active = Object.prototype.hasOwnProperty.call(TABS, tab) ? tab : 'overview';
  const released = Boolean(detail.results_released_at);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [review, setReview] = useState<ReviewOverview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [siblings, setSiblings] = useState<ClassAssignment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErrors([]);
    const copiesRequest = api.collection(detail.id);
    // Both collection and review fold completed App papers into submissions. Sequence those
    // reads on open work so the two endpoints cannot import the same paper at once.
    const analysisRequest = !released
      ? copiesRequest.catch(() => undefined).then(() => api.review(detail.id))
      : released ? api.report(detail.id) : api.review(detail.id);
    Promise.allSettled([copiesRequest, analysisRequest]).then(([copies, analysis]) => {
      if (!live) return;
      const failures: string[] = [];
      if (copies.status === 'fulfilled') setCollection(copies.value);
      else failures.push(copies.reason instanceof Error ? copies.reason.message : '收卷情况加载失败');
      if (analysis.status === 'fulfilled') {
        if (released) setReport(analysis.value as Report);
        else setReview(analysis.value as ReviewOverview);
      } else failures.push(analysis.reason instanceof Error ? analysis.reason.message : '分析加载失败');
      setErrors(failures);
      setLoading(false);
    });
    return () => { live = false; };
  }, [detail, released, attempt]);

  useEffect(() => {
    if (!detail.source_id) return;
    let live = true;
    api.assignment(detail.source_id).then((source) => live && setSiblings(source.assigned ?? []))
      .catch(() => { /* The current execution remains usable if its source is unavailable. */ });
    return () => { live = false; };
  }, [detail.source_id]);

  function switchTab(next: AnalysisTab) {
    setParams({ tab: next });
  }
  const participants = report?.class_size ?? collection?.total;
  const collected = collection?.collected ?? detail.collected ?? 0;
  const pending = review?.questions.reduce((sum, q) => sum + q.pending + (q.auto_passed ?? 0), 0);
  const appDelivery = detail.settings?.delivery === 'app';
  const onPaper = (detail.papers ?? []).filter((p) => !p.missing && p.delivery === 'paper').length;

  return <section className="assignment-workspace">
    <Link to={detail.class_id ? `/papers?class=${encodeURIComponent(detail.class_id)}` : '/papers'} className="back-link">← 作业管理</Link>
    <header className="workspace-head">
      <div><div className="workspace-title"><span className={`kind-tag ${detail.kind}`}>{detail.kind === 'personalized' ? '个性化作业' : '测验'}</span><h1>{detail.title}</h1></div>
        <p className="muted">{detail.class_name} · {participants == null ? '正在核对布置人数' : `${participants} 名参与学生`}
          {detail.settings?.student_ids && ' · 指定学生'} · {detail.kind === 'personalized' ? '每人一份作业' : `${detail.question_count} 题 · ${formatPoints(detail.total_points ?? 0)} 分`}
          {detail.published_at && ` · ${new Date(detail.published_at).toLocaleDateString('zh-CN')} 布置`}</p>
      </div>
      <div className="paper-actions">
        <span className={`chip ${released ? 'published' : ''}`}>{released ? '结果已发布' : collected ? '作答与审核中' : appDelivery ? '待作答' : '待收卷'}</span>
        {siblings.length > 1 && <select aria-label="切换作业班级" value={detail.id} onChange={(e) => navigate(`/assignments/${e.target.value}?tab=${active}`)}>
          {siblings.map((row) => <option key={row.id} value={row.id}>{row.class_name}{row.status === 'draft' ? '（草稿）' : ''}</option>)}
        </select>}
      </div>
    </header>
    {detail.removed_at && <p className="notice" role="status">该作业已从作业管理删除，保留成绩与学情供查阅。</p>}
    {!detail.removed_at && <div className="card workspace-flow">
      <AssignmentSteps detail={detail} />
      <div className="workspace-actions">
        {detail.class_id && <Link to={`/classes/${detail.class_id}`} className="link-button">班级长期学情 →</Link>}
        <button type="button" className="danger" onClick={() => setDeleting(true)}>删除作业</button>
      </div>
    </div>}
    {deleting && <DeleteAssignmentDialog assignmentId={detail.id} title={detail.title} assignedCount={1}
      onClose={() => setDeleting(false)} onDeleted={() => navigate('/papers', { replace: true, state: { notice: `已删除“${detail.title}”` } })} />}
    <nav className="tabs workspace-tabs" aria-label="作业管理与分析">
      {Object.entries(TABS).map(([key, label]) => <Link key={key} to={`?tab=${key}`} aria-current={active === key ? 'page' : undefined} className={active === key ? 'active' : ''}>{label}</Link>)}
    </nav>
    {errors.length > 0 && <div className="card"><p className="error" role="alert">{errors.join('；')}</p><button onClick={() => setAttempt((n) => n + 1)}>重新加载</button></div>}
    {loading ? <p className="muted" role="status">正在加载作业数据…</p> : released ? (
      report && <AssignmentAnalysis detail={detail} report={report} tab={active} onTab={switchTab} />
    ) : <>
      <p className="workspace-notice">结果尚未发布。当前显示收卷和审核进度，正式成绩、得分率与错因统计在发布后显示。</p>
      {active === 'overview' && <>
        <div className="metrics four">
          <Metric label="应交人数" value={participants == null ? '—' : String(participants)} />
          <Metric label="已收 / 未收" value={participants == null ? `${collected} / —` : `${collected} / ${Math.max(0, participants - collected)}`} />
          <Metric label="待处理作答" value={pending == null ? '—' : String(pending)} />
          <Metric label="结果状态" value="待发布" />
        </div>
        <PaperPreview detail={detail} />
        <div className="card"><h2>下一步</h2>
          {(detail.kind === 'personalized' || appDelivery) && <p className="muted">App 作答：{(detail.papers ?? []).filter((p) => !p.missing && p.delivery === 'app').length} 人 · 已完成 {(detail.papers ?? []).filter((p) => p.app_status?.status === 'completed').length} 人 · 作答或批改中 {(detail.papers ?? []).filter((p) => p.app_status && p.app_status.status !== 'completed').length} 人</p>}
          <p>{collected ? '继续核对收卷，完成预批和人工审核后发布结果。缺交学生不会记为零分。' : appDelivery ? '学生在 App 中完成作答，提交后自动汇总，再进行审核。' : '下载或打印作业，收回后上传扫描件。'}</p>
          {appDelivery && onPaper > 0 && <p className="muted">另有 {onPaper} 名学生没有登录过 App，按纸质作答：<Link to={`/assignments/${detail.id}/print`} target="_blank">打印</Link>后在<Link to={`/assignments/${detail.id}/collect`}>收卷</Link>中扫描上传。</p>}
          {review?.run && <p className="muted">预批任务：{review.run.status === 'running' || review.run.status === 'queued' ? '进行中' : review.run.status === 'failed' ? '失败，请到审核页处理' : '已完成'} · {review.run.done} / {review.run.total}</p>}
          <button type="button" onClick={() => switchTab('students')}>查看学生收卷情况</button></div>
      </>}
      {active === 'students' && collection && <div className="card table-card"><h2>参与学生与收卷</h2><div className="table-scroll"><table aria-label="学生收卷情况"><thead><tr><th>学号</th><th>姓名</th><th>交付方式</th><th>收卷状态</th><th>操作</th></tr></thead><tbody>
        {collection.students.map((s) => <tr key={s.student_id}><td>{s.student_number ?? '—'}</td><td>{s.display_name}</td><td>{deliveryStatus(detail.papers?.find((p) => p.student_id === s.student_id))}</td><td>{s.submission ? s.submission.status === 'needs_review' ? '已收 · 待核对' : '已收卷' : '未交'}</td><td><Link to={`/assignments/${detail.id}/collect`}>{s.submission ? '查看作答' : detail.papers?.find((p) => p.student_id === s.student_id)?.delivery === 'app' ? '查看进度' : '收卷'}</Link></td></tr>)}
      </tbody></table></div></div>}
      {active === 'questions' && review && <div className="card table-card"><h2>题目与审核进度</h2>{detail.kind === 'personalized' && <p className="muted small">这里按实际题目汇总，分析编号可能与学生卷面题号不同。</p>}<div className="table-scroll"><table aria-label="题目审核进度"><thead><tr><th>分析编号</th><th>题目</th><th>已收作答</th><th>待处理</th><th>操作</th></tr></thead><tbody>
        {review.questions.map((q) => <tr key={q.number}><td>{q.number}</td><td className="question-cell"><details><summary>{typeLabel(q.question_type)} · 查看题目</summary><RichText text={q.stem_text} imagePaths={q.image_paths} /><div className="answer">参考答案：<RichText text={q.answer ?? '未提供'} imagePaths={q.image_paths} /></div></details></td><td>{q.collected}</td><td>{q.pending + (q.auto_passed ?? 0)}</td><td><Link to={`/assignments/${detail.id}/review?question=${q.number}&filter=all`}>审核本题</Link></td></tr>)}
      </tbody></table></div></div>}
      {active === 'knowledge' && <div className="card empty"><h2>知识点与错因</h2><p>发布结果后，查看本次作业的知识点得分率、已确认错因和对应学生。</p><Link to={`/assignments/${detail.id}/review`}>去审核并发布结果</Link></div>}
    </>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="card metric"><span className="muted">{label}</span><strong>{value}</strong></div>;
}

function PaperPreview({ detail }: { detail: AssignmentDetail }) {
  const papers = (detail.papers ?? []).filter((p) => !p.missing);
  const [student, setStudent] = useState(papers[0]?.student_id ?? '');
  const paper = papers.find((p) => p.student_id === student);
  const items = paper?.items ?? detail.items;
  return <details className="card workspace-paper-preview"><summary>查看作业内容与交付</summary>
    {detail.kind === 'personalized' && <><label>学生作业 <select aria-label="预览学生作业" value={student} onChange={(e) => setStudent(e.target.value)}>{papers.map((p) => <option key={p.student_id} value={p.student_id}>{p.student_number ?? ''} {p.display_name}</option>)}</select></label><p className="muted">{deliveryStatus(paper)} · 每位学生的试卷独立布置。</p></>}
    <ol className="paper-items">{items.map((item) => <li className="paper-item" key={item.question_id}><strong>{item.number}. · {formatPoints(item.points)} 分</strong>{item.question && <><QuestionMeta question={item.question} showHistory={false} /><QuestionBody question={item.question} /></>}</li>)}</ol>
  </details>;
}

function deliveryStatus(paper?: StudentPaper) {
  if (paper?.delivery !== 'app') return '纸质';
  if (!paper.app_status) return 'App · 待作答';
  const labels = { in_progress: '作答中', grading: '批改中', completed: '已完成' };
  return `App · ${labels[paper.app_status.status]}`;
}
