import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { buildBlueprint, type BlueprintRow } from '../blueprint';
import CatalogTree, { type CatalogScope } from '../components/CatalogTree';
import QuestionBrowser, { QuestionBody, QuestionMeta } from '../components/QuestionBrowser';
import ScopePicker, { buildCatalog, scopeFromPicks, type ScopeEntry } from '../components/ScopePicker';
import DeliveryChoice, { AppDeliveryNotice, type DeliveryMode } from '../components/DeliveryChoice';
import StudentRecipients, { selectedRecipients, type StudentSelection } from '../components/StudentRecipients';
import { BOX_LABELS, formatPoints, shortDate } from '../labels';
import { isChoiceItem } from './PrintPage';
import type {
  AssignmentDetail, AssignmentItem, AssignmentSummary, BankQuestion, BoxSize, ItemInput, KnowledgePointOption,
  OutlineCounts, TeacherClassSummary, ScopeEntry as PracticeScope,
} from '../types';

export type ComposeMode = 'test' | 'personalized';

/** The paper being composed at 组卷, so an unfinished one can be picked up again next time. */
const LAST_PAPER_KEY = 'openphysics:teacher:last-paper';

function remember(id: string | null) {
  try {
    if (id) window.localStorage.setItem(LAST_PAPER_KEY, id);
    else window.localStorage.removeItem(LAST_PAPER_KEY);
  } catch {
    // Storage may be unavailable; resuming is a convenience only.
  }
}

function remembered(): string | null {
  try {
    return window.localStorage.getItem(LAST_PAPER_KEY);
  } catch {
    return null;
  }
}

function toInputs(items: AssignmentItem[]): ItemInput[] {
  return items.map((item) => ({
    question_id: item.question_id, points: item.points, box: item.box, area_mm: item.area_mm ?? null,
    ...(item.print_layout ? { print_layout: item.print_layout } : {}),
  }));
}

function catalogLabel(scope: CatalogScope, points: KnowledgePointOption[]): string {
  if (scope.kp_id) return points.find((kp) => kp.id === scope.kp_id)?.name ?? '所选知识点';
  return scope.section ?? scope.chapter ?? scope.volume ?? '全部教材';
}

/** A name the teacher can change later, so nothing has to be typed before the first question. */
function defaultTitle(mode: ComposeMode): string {
  return `${shortDate(new Date().toISOString())} ${mode === 'test' ? '测验' : '个性化作业'}`;
}

/**
 * 组卷: the teacher's home. One layout for both kinds of homework — the textbook catalogue on the
 * left, the question bank in the middle, and on the right either the paper (a test) or the drafting
 * settings (a personalized homework). Recipients are picked at the top of the right drawer.
 */
export default function ComposePage() {
  const [params] = useSearchParams();
  const [paper, setPaper] = useState<AssignmentDetail | null>(null);
  const [resume, setResume] = useState<AssignmentDetail | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // Remounting the composer starts a fresh paper.
  const [round, setRound] = useState(0);

  useEffect(() => {
    const id = remembered();
    if (!id) return;
    api.assignment(id).then((detail) => {
      // Only an unfinished paper of the teacher's own that has not gone to any class is offered.
      if (detail.status === 'draft' && !detail.class_id && detail.kind === 'test' && detail.items.length > 0
        && (detail.assigned ?? []).length === 0) setResume(detail);
      else remember(null);
    }).catch(() => remember(null));
  }, []);

  function fresh() {
    remember(null);
    setResume(null);
    setPaper(null);
    setRound((n) => n + 1);
  }

  return (
    <Composer
      key={`${round}:${params.toString()}`}
      detail={paper}
      onChange={setPaper}
      allowModeSwitch
      initialMode={params.get('mode') === 'personalized' ? 'personalized' : 'test'}
      initialClasses={params.get('for') ? [params.get('for')!] : []}
      initialStudents={params.get('for') && params.getAll('student').length ? { [params.get('for')!]: params.getAll('student') } : {}}
      initialKps={params.getAll('kp')}
      resume={paper ? null : resume}
      onResume={() => { setPaper(resume); setResume(null); }}
      onFresh={fresh}
      done={done}
      onDismissDone={() => setDone(null)}
      onAssigned={(next) => { setDone(next); fresh(); }}
    />
  );
}

/** What was just assigned or drafted for several classes, with a link to each. */
export interface Done {
  text: string;
  links: Array<{ to: string; label: string }>;
}

export function Composer({
  detail,
  onChange,
  allowModeSwitch = false,
  initialMode = 'test',
  initialClasses = [],
  initialStudents = {},
  initialKps = [],
  resume = null,
  onResume,
  onFresh,
  done = null,
  onDismissDone,
  onAssigned,
}: {
  /** null: nothing saved yet; the paper is created with its first question. */
  detail: AssignmentDetail | null;
  onChange: (next: AssignmentDetail) => void;
  allowModeSwitch?: boolean;
  initialMode?: ComposeMode;
  initialClasses?: string[];
  initialStudents?: StudentSelection;
  initialKps?: string[];
  resume?: AssignmentDetail | null;
  onResume?: () => void;
  onFresh?: () => void;
  done?: Done | null;
  onDismissDone?: () => void;
  /** Several classes got the homework: report it (at 组卷) instead of leaving the page. */
  onAssigned?: (done: Done) => void;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ComposeMode>(detail?.kind === 'personalized' ? 'personalized' : initialMode);
  const [title, setTitle] = useState(detail?.title ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [swapFor, setSwapFor] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<'publish' | 'delete' | null>(null);
  const [points, setPoints] = useState<KnowledgePointOption[]>([]);
  const [counts, setCounts] = useState<OutlineCounts | null>(null);
  const [scope, setScope] = useState<CatalogScope>({});
  const [classes, setClasses] = useState<TeacherClassSummary[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [studentSelection, setStudentSelection] = useState<StudentSelection>(initialStudents);
  const [delivery, setDelivery] = useState<DeliveryMode>('paper');
  // Personalized: the catalogue ticks are the drafting scope.
  const [focusedKps, setFocusedKps] = useState(initialKps);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [choiceCount, setChoiceCount] = useState(4);
  const [experimentCount, setExperimentCount] = useState(1);
  const [calculationCount, setCalculationCount] = useState(1);

  const items = detail?.items ?? [];
  // A class copy still in draft (made before the library) keeps its own class and publishes itself.
  const ownClass = detail?.class_id ?? null;
  const selectedIds = useMemo(() => new Set(items.map((item) => item.question_id)), [items]);
  const blueprint = useMemo(() => buildBlueprint(items), [items]);
  const catalog = useMemo(() => buildCatalog(points), [points]);
  const draftScope: PracticeScope[] = useMemo(() => focusedKps.length
    ? focusedKps.map((kp_id) => ({ kp_id })) : scopeFromPicks(catalog, picked), [catalog, picked, focusedKps]);
  const chosenList = classes.filter((item) => chosen.has(item.id));
  const recipients = selectedRecipients(chosenList, studentSelection);
  const hasEmptyRecipients = chosenList.some((item) => studentSelection[item.id]?.length === 0);
  const recipientCount = chosenList.reduce((sum, item) => sum + (studentSelection[item.id]?.length ?? item.member_count), 0);
  const totalCount = choiceCount + experimentCount + calculationCount;
  // The bank's "students who did it" counts follow the chosen class, or all classes.
  const statsClass = ownClass ?? (chosenList.length === 1 ? chosenList[0].id : null);

  useEffect(() => {
    api.knowledgePoints().then(setPoints).catch(() => setPoints([]));
    api.outline().then(setCounts).catch(() => setCounts(null));
    api.classes().then((list) => {
      setClasses(list);
      const usable = new Set(list.filter((item) => item.member_count > 0).map((item) => item.id));
      setChosen(new Set(initialClasses.filter((id) => usable.has(id))));
    }).catch(() => setClasses([]));
  }, []);

  useEffect(() => {
    if (detail) setTitle(detail.title);
  }, [detail?.id]);

  /** The paper exists from its first question on; before that nothing is saved. */
  async function ensurePaper(): Promise<AssignmentDetail> {
    if (detail) return detail;
    const created = await api.createPaper(title.trim() || defaultTitle('test'));
    remember(created.id);
    setTitle(created.title);
    onChange(created);
    return created;
  }

  async function save(data: { title?: string; items?: ItemInput[] }) {
    setBusy(true);
    setError('');
    try {
      const current = await ensurePaper();
      const next = await api.updateAssignment(current.id, data);
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  const inputs = toInputs(items);
  const add = (question: BankQuestion) => save({ items: [...inputs, { question_id: question.id }] });
  const remove = (index: number) => save({ items: inputs.filter((_, position) => position !== index) });
  const removeQuestion = (question: BankQuestion) => {
    const index = inputs.findIndex((item) => item.question_id === question.id);
    if (index >= 0) void remove(index);
  };
  const move = (index: number, offset: number) => {
    const next = [...inputs];
    const [moved] = next.splice(index, 1);
    next.splice(index + offset, 0, moved);
    return save({ items: next });
  };
  const change = (index: number, patch: Partial<ItemInput>) =>
    save({ items: inputs.map((item, position) => (position === index ? { ...item, ...patch } : item)) });
  const replace = (index: number, question: BankQuestion) => {
    setSwapFor(null);
    return change(index, { question_id: question.id });
  };

  function commitPoints(index: number, raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value === items[index].points) return;
    void change(index, { points: value });
  }

  function commitTitle() {
    const next = title.trim();
    if (detail && next && next !== detail.title) void save({ title: next });
  }

  function finished(created: AssignmentSummary[], text: string) {
    // One class: straight to it; several: say so here and link each one.
    if (created.length === 1) {
      navigate(`/assignments/${created[0].id}`);
      return;
    }
    const names = new Map(classes.map((item) => [item.id, item.name]));
    const next = {
      text,
      links: created.map((row) => ({ to: `/assignments/${row.id}`, label: names.get(row.class_id ?? '') ?? '班级' })),
    };
    if (onAssigned) onAssigned(next);
    else navigate('/papers', { state: { notice: next.text } });
  }

  /** Saving fixes the paper as it will be printed; it then waits in 我的组卷 to be downloaded and published. */
  async function savePaper() {
    if (!detail || busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await api.savePaper(detail.id);
      remember(null);
      setConfirming(null);
      // Opened from its own page the address does not change: hand the saved paper over directly.
      onChange(saved);
      navigate(`/assignments/${saved.id}`, { state: { saved: true, delivery } });
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      setConfirming(null);
      setBusy(false);
    }
  }

  async function assignPaper() {
    if (!detail || !chosen.size || !items.length || busy) return;
    setBusy(true);
    setError('');
    try {
      // Assignment freezes and saves the source paper in the same existing API call.
      const result = await api.assignTo(detail.id, [...chosen], undefined, delivery);
      remember(null);
      if (result.assigned.length === 1) navigate(`/assignments/${result.assigned[0].id}`);
      else navigate('/papers', { state: { notice: `「${detail.title}」已布置给 ${result.assigned.length} 个班。` } });
    } catch (err) {
      setError(err instanceof Error ? err.message : '布置失败');
      setConfirming(null);
      setBusy(false);
    }
  }

  async function publishOwn() {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      onChange(await api.publishAssignment(detail.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  async function deletePaper() {
    if (!detail) return;
    setBusy(true);
    try {
      await api.deleteAssignment(detail.id);
      remember(null);
      if (onFresh) onFresh();
      else navigate('/papers', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setBusy(false);
      setConfirming(null);
    }
  }

  const draftReady = chosen.size > 0 && !hasEmptyRecipients && draftScope.length > 0 && draftScope.length <= 60
    && totalCount > 0 && totalCount <= 40;

  async function draft(event?: FormEvent) {
    event?.preventDefault();
    if (!draftReady) return;
    setBusy(true);
    setError('');
    try {
      const created = await api.createPersonalizedFor({
        title: title.trim() || defaultTitle('personalized'), scope: draftScope, choice_count: choiceCount,
        experiment_count: experimentCount, calculation_count: calculationCount, class_ids: [...chosen], delivery,
        ...(Object.keys(recipients).length > 0 ? { student_ids_by_class: recipients } : {}),
      });
      finished(created.assigned, `「${title.trim() || defaultTitle('personalized')}」已为 ${created.assigned.length} 个班起草，请进入各班逐人审核后发布。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '起草失败');
    } finally {
      setBusy(false);
    }
  }

  const personalized = mode === 'personalized';

  return (
    <div className="composer-shell">
      <div className="composer-top">
        {detail && !allowModeSwitch && <Link to="/papers" className="back-link">← 作业管理</Link>}
        {allowModeSwitch && (
          <div className="segmented mode-switch" role="group" aria-label="作业类型">
            {([['test', '测验'], ['personalized', '个性化作业']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={mode === value} className={mode === value ? 'active' : ''}
                disabled={busy} onClick={() => setMode(value)}>{label}</button>
            ))}
          </div>
        )}
        <input
          aria-label="作业名称"
          className="title-input"
          value={title}
          maxLength={60}
          placeholder={personalized ? `名称（不填则为“${defaultTitle('personalized')}”）` : `测验名称（不填则为“${defaultTitle('test')}”）`}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
        />
        {ownClass && <span className="chip draft">{detail?.class_name} · 草稿</span>}
      </div>
      {error && <p className="error composer-message" role="alert">{error}</p>}
      {done && (
        <p className="notice composer-message" role="status">
          {done.text}进入各班查看：
          {done.links.map((link) => <Link key={link.to} to={link.to} className="done-link">{link.label}</Link>)}
          <button type="button" className="link-button" onClick={onDismissDone}>知道了</button>
        </p>
      )}
      {resume && !personalized && (
        <p className="notice composer-message">
          上次的组卷「{resume.title}」还有 {resume.items.length} 题没有布置。
          <button type="button" className="link-button" onClick={onResume}>继续编辑</button>
          <button type="button" className="link-button" onClick={onFresh}>重新开始</button>
        </p>
      )}

      <div className="composer-body">
        {personalized ? (
          <ScopePicker points={points} picked={picked} onPicked={(next) => { setFocusedKps([]); setPicked(next); }} counts={counts}
            onBrowse={(entry) => setScope(entry)} />
        ) : (
          <CatalogTree points={points} counts={counts} scope={scope} onScope={setScope} />
        )}
        <QuestionBrowser classId={statsClass} scope={scope} scopeLabel={catalogLabel(scope, points)}
          selectedIds={selectedIds} busy={busy} onAdd={add} onRemove={removeQuestion} preview={personalized} />

        {personalized ? (
          <form className="paper-drawer settings-drawer" aria-label="个性化作业设置" onSubmit={draft}>
            <StudentRecipients classes={classes} chosen={chosen} onClassesChange={setChosen}
              selected={studentSelection} onChange={setStudentSelection} disabled={busy} />
            <section className="settings-section">
              <h2>每人题量</h2>
              <div className="count-inputs personalized-counts">
                <label>
                  选择题
                  <input type="number" min={0} max={20} value={choiceCount}
                    onChange={(e) => setChoiceCount(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} />
                </label>
                <label>
                  实验题
                  <input type="number" min={0} max={20} value={experimentCount}
                    onChange={(e) => setExperimentCount(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} />
                </label>
                <label>
                  计算题
                  <input type="number" min={0} max={20} value={calculationCount}
                    onChange={(e) => setCalculationCount(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} />
                </label>
              </div>
            </section>
            <DeliveryChoice value={delivery} onChange={setDelivery} disabled={busy} />
            {delivery === 'app' && <AppDeliveryNotice classIds={[...chosen]} />}
            <div className="paper-actions compose-assign-actions">
              <button type="submit" className="primary" disabled={busy || !draftReady}>
                {busy ? '正在为每个学生起草…' : chosen.size > 1 ? `为 ${chosen.size} 个班起草`
                  : Object.keys(recipients).length > 0 ? `为 ${recipientCount} 名学生起草` : '起草全班作业'}
              </button>
            </div>
            {draftScope.length > 60 && <p className="error">勾选的节太多，请改为勾选整章。</p>}
            {totalCount > 40 && <p className="error">每人最多 40 题。</p>}
          </form>
        ) : (
          <section className="paper-drawer" aria-label="试卷">
            {!ownClass && <>
              <StudentRecipients classes={classes} chosen={chosen} onClassesChange={(next) => { setChosen(next); setConfirming(null); }}
                selected={{}} onChange={() => {}} disabled={busy} allowStudents={false} />
              <DeliveryChoice value={delivery} onChange={(next) => { setDelivery(next); setConfirming(null); }} disabled={busy} />
              {delivery === 'app' && <AppDeliveryNotice classIds={[...chosen]} />}
              <div className="paper-actions compose-assign-actions">
                <button type="button" className="primary" disabled={busy || !items.length || !chosen.size} onClick={() => void assignPaper()}>
                  {busy ? '正在布置…' : '完成布置'}
                </button>
              </div>
            </>}
            <div className="drawer-head">
              <h2>试卷</h2>
            </div>
            <BlueprintPanel rows={blueprint} />
            <p className="muted small">选择题自动排在最前面，学生在卷首的答题表里写选项；其余题目下方留作答区。</p>
            {items.length === 0 ? (
              <p className="muted">从题库加入题目，组好后在上方完成布置。</p>
            ) : (
              <ol className="paper-items">
                {items.map((item, index) => (
                  <li key={item.question_id} className="paper-item">
                    <div className="paper-item-head">
                      <strong>{item.number}.</strong>
                      <label className="points">
                        <input
                          aria-label={`第 ${item.number} 题分值`}
                          type="number"
                          min={0.5}
                          max={100}
                          step={0.5}
                          defaultValue={item.points}
                          key={`${item.question_id}-${item.points}`}
                          onBlur={(event) => commitPoints(index, event.target.value)}
                        />
                        分
                      </label>
                      {item.box && (
                        <select
                          aria-label={`第 ${item.number} 题作答框`}
                          value={item.area_mm ? 'custom' : item.box}
                          onChange={(event) => change(index, { box: event.target.value as BoxSize, area_mm: null })}
                        >
                          {Object.entries(BOX_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          {item.area_mm && <option value="custom" disabled>自定 {item.area_mm} mm</option>}
                        </select>
                      )}
                      <span className="item-actions">
                        {/* Choice questions always lead the paper: a move only works among questions of the same kind. */}
                        <button type="button" disabled={busy || index === 0
                          || isChoiceItem(items[index - 1]) !== isChoiceItem(item)}
                          onClick={() => move(index, -1)} aria-label={`第 ${item.number} 题上移`}>↑</button>
                        <button type="button" disabled={busy || index === items.length - 1
                          || isChoiceItem(items[index + 1]) !== isChoiceItem(item)}
                          onClick={() => move(index, 1)} aria-label={`第 ${item.number} 题下移`}>↓</button>
                        <button type="button" disabled={busy || !item.question}
                          onClick={() => setSwapFor(swapFor === index ? null : index)}>换题</button>
                        <button type="button" disabled={busy} onClick={() => remove(index)}>删除</button>
                      </span>
                    </div>
                    {item.question ? (
                      <>
                        <QuestionMeta question={item.question} />
                        <div className="clamped short"><QuestionBody question={item.question} /></div>
                      </>
                    ) : (
                      <p className="error">这道题已不在已审核题库中，请删除或替换。</p>
                    )}
                    {swapFor === index && detail && (
                      <Alternatives assignmentId={detail.id} questionId={item.question_id}
                        onPick={(question) => replace(index, question)} busy={busy} />
                    )}
                  </li>
                ))}
              </ol>
            )}

            {detail && (
              <div className="paper-actions">
                <Link to={`/assignments/${detail.id}/print`} target="_blank" className="secondary-link">预览试卷</Link>
                {!ownClass && (detail.assigned ?? []).length > 0 && (
                  <span className="muted small">
                    已布置：{(detail.assigned ?? []).map((row) => row.class_name).join('、')}
                  </span>
                )}
                {confirming === 'delete' ? (
                  <span className="confirm">
                    {ownClass ? '确定删除这份草稿？' : '确定删除这份试卷？已布置的班级不受影响。'}
                    <button type="button" className="danger" disabled={busy} onClick={deletePaper}>删除</button>
                    <button type="button" disabled={busy} onClick={() => setConfirming(null)}>取消</button>
                  </span>
                ) : confirming === 'publish' ? (
                  <span className="confirm">
                    发布后题目不能再修改。
                    <button type="button" className="primary" disabled={busy} onClick={publishOwn}>确认发布</button>
                    <button type="button" disabled={busy} onClick={() => setConfirming(null)}>取消</button>
                  </span>
                ) : (
                  <>
                    <button type="button" disabled={busy} onClick={() => setConfirming('delete')}>
                      {ownClass ? '删除草稿' : '删除试卷'}
                    </button>
                    {ownClass ? (
                      <button type="button" className="primary" disabled={busy || items.length === 0}
                        onClick={() => setConfirming('publish')}>发布测验</button>
                    ) : (
                      <button type="button" className="primary" disabled={busy || items.length === 0}
                        onClick={() => void savePaper()}>保存试卷</button>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function BlueprintPanel({ rows }: { rows: ReturnType<typeof buildBlueprint> }) {
  return (
    <div className="blueprint" aria-label="试卷蓝图">
      <div className="blueprint-totals">
        <span><strong>{rows.questionCount}</strong> 题</span>
        <span><strong>{formatPoints(rows.totalPoints)}</strong> 分</span>
        <span>约 <strong>{rows.minutes}</strong> 分钟</span>
      </div>
      {rows.questionCount > 0 && (
        <dl>
          <BlueprintLine title="题型" rows={rows.byType} />
          <BlueprintLine title="难度" rows={rows.byDifficulty} />
          <BlueprintLine title="知识点" rows={rows.byKnowledgePoint} />
        </dl>
      )}
    </div>
  );
}

function BlueprintLine({ title, rows }: { title: string; rows: BlueprintRow[] }) {
  return (
    <>
      <dt>{title}</dt>
      <dd>{rows.map((row) => `${row.label} ${row.count} 题 ${formatPoints(row.points)} 分`).join('；')}</dd>
    </>
  );
}

function Alternatives({
  assignmentId,
  questionId,
  busy,
  onPick,
}: {
  assignmentId: string;
  questionId: string;
  busy: boolean;
  onPick: (question: BankQuestion) => void;
}) {
  const [items, setItems] = useState<BankQuestion[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.alternatives(assignmentId, questionId)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'));
  }, [assignmentId, questionId]);

  if (error) return <p className="error">{error}</p>;
  if (!items) return <p className="muted small">正在找相似题…</p>;
  if (items.length === 0) return <p className="muted small">题库里没有同知识点、同题型的其他题。</p>;
  return (
    <ul className="alternatives" aria-label="可替换的相似题">
      {items.map((question) => (
        <li key={question.id} className="question-card">
          <div className="question-head">
            <QuestionMeta question={question} />
            <button type="button" className="small-button" disabled={busy} onClick={() => onPick(question)}>换成这道</button>
          </div>
          <div className="clamped short"><QuestionBody question={question} /></div>
        </li>
      ))}
    </ul>
  );
}
