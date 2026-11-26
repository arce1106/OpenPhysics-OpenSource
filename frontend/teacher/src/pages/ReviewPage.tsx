import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import AssignmentSteps from '../components/AssignmentSteps';
import { ImageViewer } from '../components/Modal';
import RichText from '../components/RichText';
import { formatPoints, percent, typeLabel } from '../labels';
import type { AssignmentDetail, GradeInput, ReviewEntry, ReviewOverview, ReviewQuestion, RubricPart } from '../types';

const POLL_MS = 2000;
const RUN_RULE = 'AI 只批改已授权学生的作答区，满分且有把握、并按审核过的评分细则给分时才自动通过；其余都需要您确认。未授权学生的作答请直接打分。';

const GRADE_LABELS: Record<string, string> = {
  ungraded: '待 AI 预批',
  manual: '人工打分',
  needs_review: '待审核',
  auto_passed: '自动通过',
  confirmed: '已确认',
};

type Filter = 'all' | 'open' | 'auto_passed' | 'confirmed';

/** Grade one question across the whole class, with AI suggestions where students authorized it. */
export default function ReviewPage() {
  const { assignmentId = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedQuestion = Number(params.get('question'));
  const requestedStudent = params.get('student');
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [overview, setOverview] = useState<ReviewOverview | null>(null);
  const [number, setNumber] = useState<number | null>(Number.isInteger(requestedQuestion) && requestedQuestion > 0 ? requestedQuestion : null);
  const [entries, setEntries] = useState<ReviewEntry[] | null>(null);
  const [filter, setFilter] = useState<Filter>(params.get('filter') === 'all' ? 'all' : 'open');
  const [errorFilter, setErrorFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmingRelease, setConfirmingRelease] = useState(false);

  const loadOverview = useCallback(async () => {
    const next = await api.review(assignmentId);
    setOverview(next);
    setNumber((current) => current ?? (next.questions.find((q) => q.kind === 'area')?.number ?? next.questions[0]?.number ?? null));
    return next;
  }, [assignmentId]);

  useEffect(() => {
    api.assignment(assignmentId).then(setDetail).catch((err) => setError(err instanceof Error ? err.message : '加载失败'));
    loadOverview().catch((err) => setError(err instanceof Error ? err.message : '加载失败'));
  }, [assignmentId, loadOverview]);

  const loadEntries = useCallback(async () => {
    if (number === null) return;
    setEntries(await api.reviewQuestion(assignmentId, number));
  }, [assignmentId, number]);

  useEffect(() => {
    setEntries(null);
    loadEntries().catch((err) => setError(err instanceof Error ? err.message : '加载失败'));
  }, [loadEntries]);

  const running = overview?.run && (overview.run.status === 'queued' || overview.run.status === 'running');
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      void loadOverview().then((next) => {
        if (!(next.run && (next.run.status === 'queued' || next.run.status === 'running'))) void loadEntries();
      });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, loadOverview, loadEntries]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await Promise.all([loadOverview(), loadEntries()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setBusy(true);
    setError('');
    try {
      if ((overview?.auto_passed ?? 0) > 0) await api.confirmAllAuto(assignmentId);
      await api.releaseResults(assignmentId);
      navigate(`/assignments/${assignmentId}/report`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
      setConfirmingRelease(false);
      setBusy(false);
    }
  }

  const question = overview?.questions.find((q) => q.number === number) ?? null;
  const visible = useMemo(() => (entries ?? []).filter((entry) => {
    if (requestedStudent && entry.student_id !== requestedStudent) return false;
    if (errorFilter && entry.error_type !== errorFilter) return false;
    if (filter === 'open') return ['ungraded', 'manual', 'needs_review'].includes(entry.grade_status ?? '');
    if (filter === 'all') return true;
    return entry.grade_status === filter;
  }), [entries, filter, errorFilter, requestedStudent]);

  if (!overview || !detail) {
    return error ? (
      <section>
        <p className="error" role="alert">{error}</p>
        <Link to="/classes">返回我的班级</Link>
      </section>
    ) : <p className="muted">正在加载审核…</p>;
  }
  const pendingTotal = overview.questions.reduce((sum, q) => sum + q.pending, 0);
  const autoPassed = overview.auto_passed ?? 0;
  const areaLeft = overview.questions.some((q) => q.kind === 'area' && q.collected > 0);

  return (
    <section>
      <Link to={`/assignments/${assignmentId}`} className="back-link">← {detail.title}</Link>
      <div className="review-title">
        <h1>预批与审核</h1>
        {/* One line beside the title, so the question and the answers get the room. */}
        <div className="run-control" title={overview.released ? undefined : RUN_RULE}>
          {overview.released ? <span>结果已发布，分数已锁定。<Link to={`/assignments/${assignmentId}/report`}>查看报告</Link></span> : (
            <>
              {overview.run ? (
                <span className={overview.run.status === 'failed' ? 'error small' : 'muted small'}>
                  {running ? `AI 预批中：${overview.run.done} / ${overview.run.total} 名学生` : `上次预批已完成（${overview.run.total} 名学生）`}
                  {overview.run.error ? `。${overview.run.error}` : ''}
                </span>
              ) : (
                <span className="muted small">满分且有把握才自动通过，其余需您确认</span>
              )}
              {areaLeft && (
                <button type="button" className="primary" disabled={busy || Boolean(running)}
                  onClick={() => act(() => api.startGrading(assignmentId))}>
                  {overview.run ? '预批剩余作答' : '开始 AI 预批'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {requestedStudent && <p className="workspace-notice">当前定位到指定学生。<Link to={`/assignments/${assignmentId}/review?question=${number ?? 1}&filter=all`}>查看本题全部学生</Link></p>}
      <AssignmentSteps detail={detail} active="review" />
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="review-layout">
        <nav className="card question-tabs" aria-label="题目">
          {overview.questions.map((q) => (
            <button key={q.number} type="button" className={q.number === number ? 'selected' : ''}
              onClick={() => setNumber(q.number)}>
              <span>第 {q.number} 题 · {typeLabel(q.question_type)}</span>
              {q.pending > 0 ? <span className="badge">{q.pending} 待处理</span> : <span className="done-mark">✓</span>}
            </button>
          ))}
        </nav>

        <div className="review-main">
          {question && <QuestionHeader question={question} assignmentId={assignmentId} locked={overview.released}
            busy={busy} act={act} onNotice={setNotice} />}
          <div className="review-answers">
          {question?.kind === 'choice' && (
            <div className="card">
              <p className="muted small">
                选择题按识别出的选项和标准答案自动判分。{question.pending > 0
                  ? `还有 ${question.pending} 份要核对或人工录入，`
                  : ''}核对和修改答案在收卷页的学生表里进行。
              </p>
              {!overview.released && (
                <Link to={`/assignments/${assignmentId}/collect`} className="primary-link">去收卷页核对选择题</Link>
              )}
            </div>
          )}
          {question?.kind === 'area' && (
            <>
              <div className="review-tools">
                <select aria-label="按状态筛选" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
                  <option value="open">待处理</option>
                  <option value="auto_passed">自动通过</option>
                  <option value="confirmed">已确认</option>
                  <option value="all">全部</option>
                </select>
                <select aria-label="按错因筛选" value={errorFilter} onChange={(event) => setErrorFilter(event.target.value)}>
                  <option value="">全部错因</option>
                  {Object.entries(overview.error_types).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                </select>
                {Boolean(question.auto_passed) && !overview.released && (
                  <button type="button" disabled={busy}
                    onClick={() => act(() => api.confirmAuto(assignmentId, question.number))}>
                    确认本题全部自动通过（{question.auto_passed}）
                  </button>
                )}
              </div>
              {entries === null ? <p className="muted">正在加载作答…</p> : visible.length === 0 ? (
                <p className="muted">没有符合条件的作答。</p>
              ) : (
                <ul className="review-entries">
                  {visible.map((entry) => (
                    <ReviewCard key={entry.item_id} entry={entry} question={question} errorTypes={overview.error_types}
                      locked={overview.released} busy={busy}
                      onSave={(data, card) => act(async () => {
                        // Move on to the next answer, as with a stack of papers.
                        const next = card?.nextElementSibling?.querySelector<HTMLElement>('input, select');
                        await api.gradeItem(entry.item_id, data);
                        next?.focus();
                      })} />
                  ))}
                </ul>
              )}
            </>
          )}
          </div>
        </div>
      </div>

      {!overview.released && (
        <div className="card release-panel">
          {pendingTotal > 0 ? (
            <p className="muted">还有 {pendingTotal} 份作答待处理，全部处理后才能发布结果。</p>
          ) : confirmingRelease ? (
            <span className="confirm">
              {autoPassed > 0 && `其中 ${autoPassed} 份是 AI 判满分自动通过的，发布即视为您已确认。`}
              {(overview.turn_in?.missing ?? 0) > 0 && <strong className="release-missing">
                还有 {overview.turn_in!.missing} 名学生未交{(overview.turn_in!.app_working + overview.turn_in!.app_grading) > 0
                  && `（其中 ${overview.turn_in!.app_working} 人正在 App 作答${overview.turn_in!.app_grading ? `、${overview.turn_in!.app_grading} 人已在 App 提交但还在批改` : ''}）`}，
                发布后他们不能再提交，这次成绩不计入他们（不记为零分）。
              </strong>}
              发布后分数锁定、收卷也锁定，并按得分率写入学生的知识点掌握度，不能再修改。
              <button type="button" className="primary" disabled={busy} onClick={release}>确认发布</button>
              <button type="button" disabled={busy} onClick={() => setConfirmingRelease(false)}>取消</button>
            </span>
          ) : (
            <>
              {(overview.turn_in?.missing ?? 0) > 0 && <p className="muted">已交 {overview.turn_in!.collected} / {overview.turn_in!.expected} 人{overview.turn_in!.app_grading > 0 && `，${overview.turn_in!.app_grading} 人的 App 作答还在批改，可稍后再发布`}。</p>}
              <button type="button" className="primary" onClick={() => setConfirmingRelease(true)}>
                {autoPassed > 0 ? `确认 ${autoPassed} 份自动通过并发布结果` : '发布结果'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function QuestionHeader({ question, assignmentId, locked, busy, act, onNotice }: {
  question: ReviewQuestion; assignmentId: string; locked: boolean; busy: boolean;
  act: (action: () => Promise<unknown>) => Promise<unknown>; onNotice: (text: string) => void;
}) {
  return (
    <div className="card question-header">
      <div className="question-body">
        <h2>第 {question.number} 题（{formatPoints(question.points)} 分）· 已收 {question.collected} 份</h2>
        <RichText text={question.stem_text} imagePaths={question.image_paths} />
        {question.answer && (
          <div className="answer"><span className="muted">标准答案：</span>
            <RichText text={question.answer} imagePaths={question.image_paths} className="inline" />
          </div>
        )}
        {question.kind === 'choice' && question.distribution && (
          <p className="distribution">
            {Object.entries(question.distribution).map(([answer, count]) => <span key={answer}>{answer}：{count} 人</span>)}
            {question.correct_rate != null && <span>正确率 {percent(question.correct_rate)}</span>}
          </p>
        )}
      </div>
      {question.kind === 'area' && <RubricPanel key={question.number} question={question} assignmentId={assignmentId}
        locked={locked} busy={busy} act={act} onNotice={onNotice} />}
    </div>
  );
}

const RUBRIC_STATE: Record<string, string> = { draft: 'AI 起草，尚未有老师确认', drafting: 'AI 正在起草', failed: 'AI 起草失败', rejected: '曾被退回' };

/**
 * The question's scoring rubric, shared by every teacher. AI drafts grade by part at once; a
 * teacher corrects and confirms here. While nobody has graded this question by hand, a correction
 * also applies to this homework and its AI grades are redone.
 */
function RubricPanel({ question, assignmentId, locked, busy, act, onNotice }: {
  question: ReviewQuestion; assignmentId: string; locked: boolean; busy: boolean;
  act: (action: () => Promise<unknown>) => Promise<unknown>; onNotice: (text: string) => void;
}) {
  const [editing, setEditing] = useState<RubricPart[] | null>(null);
  const [problem, setProblem] = useState('');
  const shown = question.rubric_parts;
  const state = question.rubric_status === 'approved'
    ? `${question.rubric_confirmed_by ?? '老师'}已确认，全校老师共用` : RUBRIC_STATE[question.rubric_status ?? ''] ?? '暂无评分细则';
  const total = (editing ?? []).reduce((sum, part) => sum + (Number(part.points) || 0), 0);
  const update = (index: number, patch: Partial<RubricPart>) =>
    setEditing((parts) => parts && parts.map((part, i) => (i === index ? { ...part, ...patch } : part)));

  function startEditing() {
    const base = question.rubric_base?.length ? question.rubric_base : shown;
    setProblem('');
    setEditing((base ?? [{ label: '全题', points: question.points, criteria: [''] }]).map((part) => ({
      label: part.label, points: 'base_points' in part ? (part as RubricPart & { base_points: number }).base_points : part.points,
      criteria: [...part.criteria],
    })));
  }
  async function save() {
    if (!editing) return;
    const parts = editing.map((part) => ({ label: part.label.trim(), points: Number(part.points),
      criteria: part.criteria.map((line) => line.trim()).filter(Boolean) }));
    if (parts.some((part) => !part.label || !(part.points > 0) || !part.criteria.length)) {
      setProblem('每个部分需要名称、大于 0 的分值和至少一条采分点。');
      return;
    }
    let result: { applied: boolean; regrade: number } | null = null;
    await act(async () => { result = await api.saveRubric(assignmentId, question.number, parts); });
    if (!result) return;
    const { applied, regrade } = result;
    setEditing(null);
    onNotice(applied
      ? `评分细则已确认，全校共用。${regrade ? `本题 ${regrade} 份 AI 预批已按新细则退回，请点“预批剩余作答”。` : '本次作业按新细则给分。'}`
      : '评分细则已确认，全校共用。本题已有人工改分，本次作业保持原细则，新细则从下一份作业起生效。');
  }

  return <div className="rubric-panel">
    <div className="rubric-panel-head">
      <strong>评分细则</strong><span className="muted small">{state}</span>
      {!locked && !editing && question.rubric_status !== 'drafting' && <span className="rubric-actions">
        <button type="button" disabled={busy} onClick={startEditing}>{question.rubric_status === 'approved' ? '修改' : '修改并确认'}</button>
        <button type="button" disabled={busy} onClick={() => void act(async () => {
          await api.redraftRubric(assignmentId, question.number); onNotice('已请 AI 重新起草，完成后会替换全校共用的细则。');
        })}>重新起草</button>
      </span>}
    </div>
    {editing ? <div className="rubric-editor">
      {editing.map((part, index) => <div className="rubric-editor-row" key={index}>
        <input aria-label={`第 ${index + 1} 部分名称`} value={part.label} onChange={(e) => update(index, { label: e.target.value })} />
        <input aria-label={`第 ${index + 1} 部分分值`} type="number" min={0.5} step={0.5} value={part.points}
          onChange={(e) => update(index, { points: Number(e.target.value) })} />
        <textarea aria-label={`第 ${index + 1} 部分采分点`} rows={Math.max(2, part.criteria.length)} value={part.criteria.join('\n')}
          placeholder="每行一条，如：写出 $v=v_0+at$ 得 2 分" onChange={(e) => update(index, { criteria: e.target.value.split('\n') })} />
        <button type="button" disabled={editing.length === 1} onClick={() => setEditing((parts) => parts && parts.filter((_, i) => i !== index))}>删除</button>
      </div>)}
      <p className="muted small">合计 {formatPoints(total)} 分，按本题在试卷上的 {formatPoints(question.points)} 分等比例换算。
        确认后全校老师共用。{question.rubric_applies_here ? '本次作业这道题的 AI 预批会按新细则重做，老师改过的分不受影响。' : '本次作业这道题已有人工改分，新细则从下一份作业起生效。'}</p>
      {problem && <p className="error" role="alert">{problem}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={() => setEditing((parts) => parts && [...parts, { label: `(${parts.length + 1})`, points: 2, criteria: [''] }])}>添加部分</button>
        <button type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button>
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>确认细则</button>
      </div>
    </div> : shown ? <ul className="rubric">
      {shown.map((part) => <li key={part.label}>
        <strong>{part.label}（{formatPoints(part.points)} 分）</strong>
        {part.criteria.map((text, index) => <RichText key={index} text={text} className="criterion" />)}
      </li>)}
    </ul> : <p className="muted small">{question.rubric_status === 'drafting' ? 'AI 正在起草，下次预批时按小问给分。'
      : question.rubric_frozen && question.rubric_base?.length ? '本次批改开始时这道题还没有细则，按整题给分；修改并确认后，未经人工改分的作答会按细则重新预批。'
      : 'AI 预批前会自动起草细则；也可以先手动填写。'}</p>}
  </div>;
}

function ReviewCard({
  entry,
  question,
  errorTypes,
  locked,
  busy,
  onSave,
}: {
  entry: ReviewEntry;
  question: ReviewQuestion;
  errorTypes: Record<string, string>;
  locked: boolean;
  busy: boolean;
  onSave: (data: GradeInput, card: HTMLLIElement | null) => void;
}) {
  const card = useRef<HTMLLIElement>(null);
  const [viewing, setViewing] = useState<{ src: string; alt: string } | null>(null);
  const [problem, setProblem] = useState('');
  const parts = question.rubric_parts;
  const initialParts = Object.fromEntries((parts ?? []).map((part) => [
    part.label, String(entry.part_scores?.find((p) => p.label === part.label)?.score ?? ''),
  ]));
  const [partScores, setPartScores] = useState<Record<string, string>>(initialParts);
  const [score, setScore] = useState(entry.score != null ? String(entry.score) : '');
  const [errorType, setErrorType] = useState(entry.error_type ?? '');
  const [comment, setComment] = useState(entry.teacher_comment ?? '');
  const reasons = Object.fromEntries((entry.part_scores ?? []).map((part) => [part.label, part.reason]));

  function save() {
    // An empty box is not a zero: the teacher must give every score, even 0, on purpose.
    const blank = parts ? parts.filter((part) => (partScores[part.label] ?? '').trim() === '').map((part) => part.label)
      : (score.trim() === '' ? ['得分'] : []);
    if (blank.length) {
      setProblem(`请先填写${blank.join('、')}的得分（没有得分请填 0）`);
      return;
    }
    setProblem('');
    const data: GradeInput = { comment };
    if (errorType) data.error_type = errorType;
    if (parts) data.part_scores = parts.map((part) => ({ label: part.label, score: Number(partScores[part.label]) }));
    else data.score = Number(score);
    onSave(data, card.current);
  }

  return (
    <li ref={card} className={`card review-card ${entry.grade_status ?? ''}`}>
      <div className="review-card-head">
        <strong>{entry.student_number ? `${entry.student_number} · ` : ''}{entry.display_name}</strong>
        <span className={`chip grade-${entry.grade_status}`}>{GRADE_LABELS[entry.grade_status ?? ''] ?? '—'}</span>
        {!entry.ai_authorized && <span className="muted small">未授权 AI</span>}
        {entry.confidence != null && <span className="muted small">AI 把握 {percent(entry.confidence)}</span>}
      </div>
      {entry.image_url ? (
        <button type="button" className="image-button"
          onClick={() => setViewing({ src: entry.image_url!, alt: `${entry.display_name} 第 ${question.number} 题作答` })}>
          <img className="answer-crop" src={entry.image_url} alt={`${entry.display_name} 第 ${question.number} 题作答`} />
        </button>
      ) : entry.answer ? (
        <div className="typed-answer"><span className="muted small">学生在 App 中作答：</span>
          <RichText text={entry.answer} imagePaths={[]} className="inline" /></div>
      ) : (entry.page_urls ?? []).length > 0 ? (
        <p className="error small">
          这道题的作答区没能切出来，请看整页打分：
          {(entry.page_urls ?? []).map((src, index) => (
            <button key={src} type="button" className="link-button"
              onClick={() => setViewing({ src, alt: `${entry.display_name} 的卷子第 ${index + 1} 页` })}>第 {index + 1} 页</button>
          ))}
        </p>
      ) : <p className="error small">没有找到这份作答区，请对照纸质卷打分。</p>}
      {entry.ai_error && <p className="error small">{entry.ai_error}</p>}
      {entry.first_error && <p className="small"><span className="muted">第一处错误：</span><RichText text={entry.first_error} inline /></p>}
      {entry.feedback && <p className="small"><span className="muted">AI 建议（仅供参考，不发给学生）：</span><RichText text={entry.feedback} inline /></p>}
      <div className="grade-inputs">
        {parts ? parts.map((part) => (
          <label key={part.label} className="part-input">
            <span>{part.label}</span>
            <input aria-label={`${entry.display_name} ${part.label} 得分`} type="number" min={0} max={part.points} step={0.5}
              value={partScores[part.label] ?? ''} disabled={locked}
              onChange={(event) => setPartScores({ ...partScores, [part.label]: event.target.value })} />
            <span className="muted">/ {formatPoints(part.points)}</span>
            {reasons[part.label] && <RichText text={reasons[part.label]} inline className="muted small reason" />}
          </label>
        )) : (
          <label className="part-input">
            <span>得分</span>
            <input aria-label={`${entry.display_name} 得分`} type="number" min={0} max={question.points} step={0.5}
              value={score} disabled={locked} onChange={(event) => setScore(event.target.value)} />
            <span className="muted">/ {formatPoints(question.points)}</span>
            {reasons['全题'] && <RichText text={reasons['全题']} inline className="muted small reason" />}
          </label>
        )}
        <select aria-label={`${entry.display_name} 错因`} value={errorType} disabled={locked}
          onChange={(event) => setErrorType(event.target.value)}>
          <option value="">错因</option>
          {Object.entries(errorTypes).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
        <input aria-label={`${entry.display_name} 评语`} placeholder="老师评语（可选，学生端开放后可见）" value={comment}
          disabled={locked} maxLength={300} onChange={(event) => setComment(event.target.value)} />
        {!locked && <button type="button" disabled={busy} onClick={save}>确认</button>}
      </div>
      {problem && <p className="error small" role="alert">{problem}</p>}
      {viewing && <ImageViewer src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />}
    </li>
  );
}
