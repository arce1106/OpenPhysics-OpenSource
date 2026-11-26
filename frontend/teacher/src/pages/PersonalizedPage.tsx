import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import DeliveryChoice, { type DeliveryMode } from '../components/DeliveryChoice';
import AssignmentSteps, { currentStep } from '../components/AssignmentSteps';
import { QuestionBody, QuestionMeta } from '../components/QuestionBrowser';
import { scopeLabel } from '../components/ScopePicker';
import { formatPoints } from '../labels';
import type { AssignmentDetail, BankQuestion, ItemInput, PaperItem, StudentPaper } from '../types';

export const RULE_LABELS: Record<string, string> = {
  same_error: '同错因变式',
  weak_kp: '薄弱补练',
  step_up: '难度升级',
  coverage: '范围补充',
  teacher: '老师选入',
};

const APP_STATUS: Record<string, string> = { in_progress: '作答中', grading: '批改中', completed: '已完成' };

function deliveryLabel(paper: StudentPaper): string {
  if (paper.missing) return '没有作业';
  if (paper.delivery === 'paper') return '纸质';
  return paper.app_status ? `App · ${APP_STATUS[paper.app_status.status] ?? paper.app_status.status}` : 'App';
}

function toInputs(items: PaperItem[]): ItemInput[] {
  return items.map((item) => ({ question_id: item.question_id, points: item.points, box: item.box, area_mm: item.area_mm ?? null }));
}

/** A personalized homework: one paper per student, each question with the reason it was chosen. */
const SEEN_KEY = 'openphysics:teacher:seen-papers:';

/** Which students' papers the teacher has opened in this draft: a per-browser convenience. */
function useSeen(assignmentId: string): [Set<string>, (studentId: string) => void] {
  const [seen, setSeen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(window.localStorage.getItem(SEEN_KEY + assignmentId) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const mark = useCallback((studentId: string) => setSeen((current) => {
    if (current.has(studentId)) return current;
    const next = new Set(current).add(studentId);
    try {
      window.localStorage.setItem(SEEN_KEY + assignmentId, JSON.stringify([...next]));
    } catch {
      // Storage may be unavailable; the marks then last for this visit only.
    }
    return next;
  }), [assignmentId]);
  return [seen, mark];
}

export default function PersonalizedPage({ detail, onChange }: {
  detail: AssignmentDetail;
  onChange: (next: AssignmentDetail) => void;
}) {
  const navigate = useNavigate();
  const papers = detail.papers ?? [];
  const [selected, setSelected] = useState(papers[0]?.student_id ?? '');
  const [seen, markSeen] = useSeen(detail.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<'publish' | 'delete' | null>(null);
  const draft = detail.status === 'draft';
  const paper = papers.find((each) => each.student_id === selected) ?? papers[0];
  useEffect(() => {
    if (draft && paper) markSeen(paper.student_id);
  }, [draft, paper, markSeen]);
  const withPaper = papers.filter((each) => !each.missing);
  const waiting = papers.filter((each) => each.missing);
  const onApp = withPaper.filter((each) => each.delivery === 'app').length;
  const delivery: DeliveryMode | null = detail.settings?.delivery ?? (withPaper.length ? onApp === withPaper.length ? 'app' : onApp === 0 ? 'paper' : null : null);
  const unseen = withPaper.filter((each) => !seen.has(each.student_id)).length;
  const appDone = withPaper.filter((each) => each.app_status?.status === 'completed').length;
  const appWorking = withPaper.filter((each) => each.delivery === 'app' && each.app_status && each.app_status.status !== 'completed').length;
  const chapters = (detail.settings?.scope ?? []).filter((entry) => entry.volume)
    .map((entry) => scopeLabel({ ...entry, volume: entry.volume! }));

  async function run(action: () => Promise<AssignmentDetail | null>) {
    setBusy(true);
    setError('');
    try {
      const next = await action();
      if (next) onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteAssignment(detail.id);
      navigate(`/papers?class=${detail.class_id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setBusy(false);
    }
  }

  return (
    <section>
      <Link to={`/papers?class=${detail.class_id}`} className="back-link">← 作业管理</Link>
      <div className="composer-head">
        <h1>{detail.title}</h1>
        <span className={`chip ${detail.status}`}>
          {detail.class_name} · {draft ? '个性化作业 · 待审核发布' : '个性化作业 · 已发布'}
        </span>
      </div>
      <p className="muted">
        范围：{chapters.join('、') || '未设置'} · 每人选择题 {detail.settings?.choice_count ?? 0} 道、
        {detail.settings?.experiment_count != null || detail.settings?.calculation_count != null
          ? `实验题 ${detail.settings?.experiment_count ?? 0} 道、计算题 ${detail.settings?.calculation_count ?? 0} 道`
          : `非选择题 ${detail.settings?.area_count ?? 0} 道`}
        · {withPaper.length} 人，其中 {onApp} 人在 App 作答、{withPaper.length - onApp} 人打印
        {detail.settings?.student_ids && ' · 仅布置给指定学生'}
        {!draft && ` · 已收 ${detail.collected ?? 0} 份（App 已完成 ${appDone} 人，作答中 ${appWorking} 人）`}
      </p>
      {waiting.length > 0 && (
        <p className="notice">
          {draft
            ? `${waiting.map((each) => each.display_name).join('、')} 是起草后才加入班级的，还没有作业：在左侧选中后点“起草”。`
            : `${waiting.map((each) => each.display_name).join('、')} 是发布后才加入班级的，这次作业不包括他们。`}
        </p>
      )}

      {draft ? (
        <div className="card next-step">
          <p>已查看 {withPaper.length - unseen} / {withPaper.length} 人。</p>
          <DeliveryChoice value={delivery} disabled={busy} onChange={(mode) => void run(() => api.setDeliveryAll(detail.id, mode))} />
          <div className="paper-actions">
            {withPaper.length - onApp > 0 && (
              <Link to={`/assignments/${detail.id}/print`} target="_blank" className="secondary-link">打印预览</Link>
            )}
            {confirming === 'publish' ? (
              <span className="confirm">
                {unseen > 0 && `还有 ${unseen} 人的作业没有打开看过。`}
                发布后题目不能再修改。
                <button type="button" className="primary" disabled={busy || !delivery}
                  onClick={() => run(() => api.publishAssignment(detail.id))}>确认发布</button>
                <button type="button" disabled={busy} onClick={() => setConfirming(null)}>取消</button>
              </span>
            ) : confirming === 'delete' ? (
              <span className="confirm">
                确定删除这份草稿？
                <button type="button" className="danger" disabled={busy} onClick={remove}>删除</button>
                <button type="button" disabled={busy} onClick={() => setConfirming(null)}>取消</button>
              </span>
            ) : (
              <>
                <button type="button" className="primary" disabled={busy || !delivery} onClick={() => setConfirming('publish')}>发布作业</button>
                <button type="button" disabled={busy} onClick={() => setConfirming('delete')}>删除草稿</button>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <AssignmentSteps detail={detail} />
          <div className="card next-step">
            <p>{delivery === 'app' ? `已推送到学生 App，完成作答后自动汇总。${withPaper.length - onApp > 0 ? `${withPaper.length - onApp} 名学生按纸质作答，打印后收卷扫描。` : ''}` : '打印作业，收回后扫描上传。'}</p>
            <div className="paper-actions">
              {papers.length - onApp > 0 && (
                <Link to={`/assignments/${detail.id}/print`} target="_blank" className="secondary-link">打印纸质作业</Link>
              )}
              {withPaper.length - onApp > 0 && currentStep(detail) !== 'report' && (
                <Link to={`/assignments/${detail.id}/collect`}
                  className={currentStep(detail) === 'collect' ? 'primary-link' : 'secondary-link'}>
                  {detail.collected ? '收卷情况' : '收卷'}
                </Link>
              )}
              {currentStep(detail) === 'review' && <Link to={`/assignments/${detail.id}/review`} className="primary-link">预批与审核</Link>}
              {currentStep(detail) === 'report' && <Link to={`/assignments/${detail.id}/report`} className="primary-link">查看报告</Link>}
            </div>
          </div>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="personalized-layout">
        <ul className="student-list card" aria-label="学生">
          {papers.map((each) => (
            <li key={each.student_id}>
              <button type="button" className={each.student_id === paper?.student_id ? 'on' : ''}
                onClick={() => setSelected(each.student_id)}>
                <span className="student-name">
                  {each.student_number ? `${each.student_number} ` : ''}{each.display_name}
                  {draft && !each.missing && !seen.has(each.student_id) && <span className="dot" aria-label="未查看" />}
                </span>
                <span className={`muted small${each.missing ? ' error' : ''}`}>
                  {deliveryLabel(each)}{each.missing ? '' : ` · ${each.items.length} 题`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {paper && (
          <PaperPanel key={paper.student_id} detail={detail} paper={paper} draft={draft} busy={busy} run={run} />
        )}
      </div>
    </section>
  );
}

function PaperPanel({ detail, paper, draft, busy, run }: {
  detail: AssignmentDetail;
  paper: StudentPaper;
  draft: boolean;
  busy: boolean;
  run: (action: () => Promise<AssignmentDetail | null>) => Promise<void>;
}) {
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [options, setOptions] = useState<BankQuestion[] | null>(null);
  const save = (items: ItemInput[]) => run(() => api.updatePaper(detail.id, paper.student_id, { items }));

  async function openSwap(item: PaperItem) {
    if (swapFor === item.question_id) {
      setSwapFor(null);
      return;
    }
    setSwapFor(item.question_id);
    setOptions(null);
    setOptions(await api.paperAlternatives(detail.id, paper.student_id, item.question_id).catch(() => []));
  }

  function swap(item: PaperItem, question: BankQuestion) {
    setSwapFor(null);
    void save(toInputs(paper.items).map((input) => (input.question_id === item.question_id
      ? { question_id: question.id } : input)));
  }

  return (
    <div className="card paper-panel" aria-label={`${paper.display_name} 的作业`}>
      <div className="paper-panel-head">
        <strong>{paper.display_name}</strong>
        {paper.student_number && <span className="muted">学号 {paper.student_number}</span>}
        <span className="muted">{paper.items.length} 题 · {formatPoints(paper.total_points)} 分</span>
        {paper.missing ? (
          draft ? (
            <button type="button" className="primary" disabled={busy}
              onClick={() => run(() => api.redraftPaper(detail.id, paper.student_id))}>起草</button>
          ) : <span className="chip">发布后加入，未布置</span>
        ) : draft ? (
          <>
            <span className="chip">{deliveryLabel(paper)}</span>
            {detail.settings?.delivery !== 'paper' && <button type="button" disabled={busy}
              onClick={() => run(() => api.updatePaper(detail.id, paper.student_id, { delivery: paper.delivery === 'app' ? 'paper' : 'app' }))}>
              {paper.delivery === 'app' ? '改为纸质' : '改为 App'}</button>}
            <button type="button" disabled={busy}
              onClick={() => run(() => api.redraftPaper(detail.id, paper.student_id))}>重新起草</button>
          </>
        ) : (
          <span className="chip">{deliveryLabel(paper)}</span>
        )}
      </div>
      <ol className="paper-items">
        {paper.items.map((item) => (
          <li key={item.question_id} className="paper-item">
            <div className="paper-item-head">
              <strong>{item.number}.</strong>
              {item.rule && <span className={`rule-chip ${item.rule}`}>{RULE_LABELS[item.rule] ?? item.rule}</span>}
              <span className="muted">{formatPoints(item.points)} 分</span>
              {draft && (
                <span className="item-actions">
                  <button type="button" disabled={busy} onClick={() => openSwap(item)}>换题</button>
                  <button type="button" disabled={busy || paper.items.length <= 1}
                    onClick={() => save(toInputs(paper.items).filter((input) => input.question_id !== item.question_id))}>
                    删除
                  </button>
                </span>
              )}
            </div>
            {item.reason && <p className="paper-reason">推荐理由：{item.reason}</p>}
            {item.question ? (
              <>
                <QuestionMeta question={item.question} />
                <div className="clamped short"><QuestionBody question={item.question} /></div>
              </>
            ) : <p className="error">这道题已不在已审核题库中，请换题或删除。</p>}
            {swapFor === item.question_id && (
              <div className="swap-options">
                {options === null ? <p className="muted small">正在找同知识点、该生没做过的题…</p>
                  : options.length === 0 ? <p className="muted small">没有可换的题。</p>
                  : options.map((question) => (
                    <div key={question.id} className="swap-option">
                      <QuestionMeta question={question} />
                      <div className="clamped short"><QuestionBody question={question} /></div>
                      <button type="button" disabled={busy} onClick={() => swap(item, question)}>换成这道</button>
                    </div>
                  ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
