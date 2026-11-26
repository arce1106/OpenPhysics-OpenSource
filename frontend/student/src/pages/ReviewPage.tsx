import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { getStudentId, getStudentProfile } from '../api/studentIdentity';
import LatexSpan from '../components/LatexSpan';
import PrintableQuestionSet from '../components/PrintableQuestionSet';
import QuestionSessionRunner from '../components/QuestionSessionRunner';
import AccountAccessPanel from '../components/AccountAccessPanel';
import {
  ReviewEmptyState,
  ReviewHeader,
  ReviewPrintToolbar,
  WrongQuestionCard,
  getReviewAnswerImagePaths,
} from '../components/review';
import { canonicalKpName } from '../utils/knowledgeNames';
import { canReadLearningHistory } from '../utils/learningAccess';
import {loadAttemptResults,loadPracticeRecord,newPracticeRecord,savePracticeRecord,saveAttemptResult} from '../utils/practicePersistence';
import {attemptSubmissionId, newSubmissionId} from '../utils/submissionIdentity';
import type {
  Question,
  ReviewCenter,
  ReviewData,
  ReviewGroup,
  ReviewMistake,
  SubmitResult,
  VariationQuestion,
} from '../types';

export { StudentAnswerDisplay, getReviewAnswerImagePaths } from '../components/review';

type ReviewRoute =
  | { kind: 'home' }
  | { kind: 'mistake'; answerId: number }
  | { kind: 'variation'; answerId: number };

interface ReviewMistakeWithGroup {
  mistake: ReviewMistake;
  group: ReviewGroup;
}

interface ReviewPracticeState {
  persistenceKey: string;
  attemptKeyFor: (answerId: number) => string;
  onAbandon: (answerId: number) => void;
  retrying: Set<number>;
  similarQuestions: Record<number, Question | null>;
  variationQuestions: Record<number, VariationQuestion[]>;
  retryResults: Record<number, SubmitResult>;
  clearedMistakes: Set<number>;
  onRetry: (answerId: number) => void;
  onSubmitRetry: (answerId: number, questionId: string, givenAnswer: string) => Promise<SubmitResult>;
  onAnsweredRetry: (answerId: number, result: SubmitResult) => void;
  getRetryTimeSpentMs: (answerId: number) => number;
}

export default function ReviewPage() {
  const studentId=getStudentId();
  const [ownerToken] = useState(() => localStorage.getItem('openphysics.student_token'));
  const mountedRef = useRef(true);
  const isCurrent = () => mountedRef.current && localStorage.getItem('openphysics.student_token') === ownerToken;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [practiceRecord]=useState(()=>loadPracticeRecord(studentId,'review') || newPracticeRecord(studentId,'review'));
  const restored=practiceRecord.payload;
  const [retryAttemptIds, setRetryAttemptIds] = useState<Record<number, string>>(
    (restored.retryAttemptIds as Record<number, string>) || {},
  );
  const [attemptedQuestionIds, setAttemptedQuestionIds] = useState<Record<number, string[]>>(
    (restored.attemptedQuestionIds as Record<number, string[]>) || {},
  );
  const retryRequests = useRef(new Set<number>());
  const attemptKeyFor = (answerId: number) => `${studentId}:${practiceRecord.id}:${answerId}${retryAttemptIds[answerId] ? `:${retryAttemptIds[answerId]}` : ''}`;
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [similarQuestions, setSimilarQuestions] = useState<Record<number, Question | null>>((restored.similarQuestions as Record<number,Question | null>) || {});
  const [variationQuestions, setVariationQuestions] = useState<Record<number, VariationQuestion[]>>((restored.variationQuestions as Record<number,VariationQuestion[]>) || {});
  const [retryResults, setRetryResults] = useState<Record<number, SubmitResult>>(()=>{
    const results={...(restored.retryResults as Record<number,SubmitResult>) || {}};
    Object.entries(similarQuestions).forEach(([answerId,question])=>{
      if(!question)return;
      const result=loadAttemptResults(attemptKeyFor(Number(answerId)))[question.id];
      if(result)results[Number(answerId)]=result;
    });
    return results;
  });
  const [retrying, setRetrying] = useState<Set<number>>(new Set());
  const [retryStartedAt, setRetryStartedAt] = useState<Record<number, number>>({});
  const [clearedMistakes, setClearedMistakes] = useState<Set<number>>(new Set());
  const [selectedPrintMistakes, setSelectedPrintMistakes] = useState<Set<number>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const autoLoadedVariationRef=useRef<number | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const route = parseReviewRoute(location.pathname);
  const variationRouteAnswerId = route.kind === 'variation' ? route.answerId : null;
  const canReadHistory = canReadLearningHistory(getStudentProfile());

  useEffect(()=>{
    savePracticeRecord({...practiceRecord,payload:{similarQuestions,variationQuestions,retryResults,retryAttemptIds,attemptedQuestionIds}});
  },[practiceRecord,similarQuestions,variationQuestions,retryResults,retryAttemptIds,attemptedQuestionIds]);

  const fetchData = useCallback(async () => {
    if (!canReadHistory) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const d = await api.getReview(studentId);
      setData(d);
    } catch (e: any) {
      setError(e.message || '加载错题失败');
    } finally {
      setLoading(false);
    }
  }, [canReadHistory, studentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!data) return;
    if (location.pathname === '/review/session') {
      navigate('/review', { replace: true });
      return;
    }
    if (route.kind !== 'home') return;
    const raw = new URLSearchParams(location.search).get('answer_id');
    const answerId = raw ? Number(raw) : NaN;
    if (Number.isFinite(answerId)) {
      navigate(`/review/mistake/${answerId}`, { replace: true });
    }
  }, [data, location.pathname, location.search, navigate, route.kind]);

  const allMistakeItems = useMemo(
    () => data?.groups.flatMap(group => group.mistakes.map(mistake => ({ mistake, group }))) || [],
    [data],
  );
  const selectedPrintQuestions = allMistakeItems
    .filter(({ mistake }) => selectedPrintMistakes.has(mistake.answer_id))
    .map(({ mistake }) => mistakeToPrintableQuestion(mistake));

  const prepareRetryQuestion = async (answerId: number, newRound = false) => {
    if (retryRequests.current.has(answerId)) return false;
    const previousQuestion = variationQuestions[answerId]?.[0]?.question || similarQuestions[answerId];
    if (previousQuestion && !newRound) {
      setRetryStartedAt(prev => ({ ...prev, [answerId]: prev[answerId] || Date.now() }));
      return true;
    }
    setActionError(null);
    retryRequests.current.add(answerId);
    setRetrying(prev => new Set([...prev, answerId]));
    try {
      const excluded = [...new Set([
        ...(attemptedQuestionIds[answerId] || []),
        ...(newRound && previousQuestion ? [previousQuestion.id] : []),
      ])].slice(-200);
      const variations = excluded.length
        ? await api.getVariations(answerId, studentId, excluded)
        : await api.getVariations(answerId, studentId);
      if (!isCurrent()) return false;
      const available = variations.variations.filter(item => !excluded.includes(item.question.id));
      let question: Question | undefined = available[0]?.question;
      if (!question) {
        const result = excluded.length
          ? await api.retrySimilar(answerId, studentId, excluded)
          : await api.retrySimilar(answerId, studentId);
        question = result.question && !excluded.includes(result.question.id) ? result.question : undefined;
      }
      if (!isCurrent()) return false;
      if (!question) {
        setActionError('暂时没有更多合适的变式题，可先回看解析，稍后再练。');
        return false;
      }
      if (newRound) {
        setRetryAttemptIds(prev => ({ ...prev, [answerId]: newSubmissionId() }));
        setRetryResults(prev => {
          const next = { ...prev };
          delete next[answerId];
          return next;
        });
      }
      setAttemptedQuestionIds(prev => ({ ...prev, [answerId]: excluded }));
      setVariationQuestions(prev => ({ ...prev, [answerId]: available }));
      setSimilarQuestions(prev => ({ ...prev, [answerId]: question! }));
      setRetryStartedAt(prev => ({ ...prev, [answerId]: Date.now() }));
      return true;
    } catch (e: any) {
      setActionError(e.message || '续费后可继续使用变式巩固。');
      return false;
    } finally {
      retryRequests.current.delete(answerId);
      setRetrying(prev => {
        const next = new Set(prev);
        next.delete(answerId);
        return next;
      });
    }
  };

  const handleRetry = async (answerId: number) => {
    const ready = await prepareRetryQuestion(answerId, retryResults[answerId]?.is_correct === false);
    if (ready) navigate(`/review/mistake/${answerId}/variation`);
  };

  const markMistakeCleared = (answerId: number) => {
    if (clearedMistakes.has(answerId)) return;
    setClearedMistakes(prev => new Set([...prev, answerId]));
    setData(prev => prev ? {
      ...prev,
      clearance_progress: {
        reviewed: Math.min(prev.clearance_progress.total, prev.clearance_progress.reviewed + 1),
        total: prev.clearance_progress.total,
      },
    } : prev);
  };

  const clearMistakeAfterCorrectRetry = async (answerId: number, result: SubmitResult): Promise<SubmitResult> => {
    if (!isCurrent()) return result;
    if (!result.is_correct) {
      return { ...result, cleared: false };
    }
    try {
      const response = await api.completeReview(answerId);
      if (response.cleared) markMistakeCleared(answerId);
      return { ...result, cleared: response.cleared };
    } catch {
      setActionError('变式题已完成批改，但错题清除失败，请稍后刷新重试。');
      return { ...result, cleared: false };
    }
  };

  useEffect(() => {
    if (variationRouteAnswerId === null) {
      autoLoadedVariationRef.current=null;
      return;
    }
    if (!data || autoLoadedVariationRef.current===variationRouteAnswerId) return;
    if (
      variationQuestions[variationRouteAnswerId]?.length
      || similarQuestions[variationRouteAnswerId]
      || retrying.has(variationRouteAnswerId)
    ) return;
    autoLoadedVariationRef.current=variationRouteAnswerId;
    void prepareRetryQuestion(variationRouteAnswerId);
  }, [data, variationRouteAnswerId, variationQuestions, similarQuestions, retrying]);

  const handleSubmitRetry = async (
    answerId: number,
    questionId: string,
    givenAnswer: string,
  ): Promise<SubmitResult> => {
    setActionError(null);
    const startedAt = retryStartedAt[answerId] || Date.now();
    const retryQuestion = variationQuestions[answerId]
      ?.find(item => item.question.id === questionId)?.question
      || similarQuestions[answerId];
    const result = await api.submitAnswer(studentId, {
      question_id: questionId,
      given_answer: givenAnswer,
      time_spent_ms: Date.now() - startedAt,
      target_knowledge_point_id: retryQuestion?.target_knowledge_point_id,
      submission_id:attemptSubmissionId(`${attemptKeyFor(answerId)}:${questionId}:${givenAnswer}`),
    });
    saveAttemptResult(attemptKeyFor(answerId), questionId, result);
    return clearMistakeAfterCorrectRetry(answerId, result);
  };

  const togglePrintMistake = (answerId: number) => {
    setSelectedPrintMistakes(prev => {
      const next = new Set(prev);
      if (next.has(answerId)) next.delete(answerId);
      else next.add(answerId);
      return next;
    });
  };

  const selectAllPrintMistakes = () => {
    setSelectedPrintMistakes(new Set(allMistakeItems.map(({ mistake }) => mistake.answer_id)));
  };

  const clearPrintMistakes = () => {
    setSelectedPrintMistakes(new Set());
  };

  if (!canReadHistory) {
    return (
      <div className="container no-print review-workspace">
        <ReviewHeader
          title="错题本"
          subtitle="把错题变成下一次做对的证据。"
        />
        <AccountAccessPanel
          features={['错题归因', 'AI 讲解', '变式巩固', '复盘记录']}
        />
      </div>
    );
  }

  if (loading) return <div className="loading">加载中...</div>;
  if (error) return (
    <div className="container review-workspace review-error-state">
      <div className="error-banner">{error}</div>
      <button onClick={fetchData} className="page-back-button">重试</button>
    </div>
  );
  if (!data) return null;

  const practiceState: ReviewPracticeState = {
    onAbandon: answerId => {
      const nextIds = { ...retryAttemptIds, [answerId]: newSubmissionId() };
      savePracticeRecord({ ...practiceRecord, payload: { similarQuestions, variationQuestions, retryResults,
        retryAttemptIds: nextIds, attemptedQuestionIds } });
      setRetryAttemptIds(nextIds);
    },
    persistenceKey:`${studentId}:${practiceRecord.id}`,
    attemptKeyFor,
    retrying,
    similarQuestions,
    variationQuestions,
    retryResults,
    clearedMistakes,
    onRetry: handleRetry,
    onSubmitRetry: handleSubmitRetry,
    onAnsweredRetry: (answerId, result) => {
      const question = similarQuestions[answerId];
      if (question) saveAttemptResult(attemptKeyFor(answerId), question.id, result);
      if (!isCurrent()) return;
      setRetryResults(prev => ({ ...prev, [answerId]: result }));
      if (result.cleared) markMistakeCleared(answerId);
    },
    getRetryTimeSpentMs: (answerId) => Date.now() - (retryStartedAt[answerId] || Date.now()),
  };
  const detailItem = route.kind === 'mistake' || route.kind === 'variation'
    ? allMistakeItems.find(({ mistake }) => mistake.answer_id === route.answerId) || null
    : null;

  return (
    <>
      <PrintableQuestionSet
        title="错题本"
        subtitle={`已选择 ${selectedPrintQuestions.length} 道错题`}
        questions={selectedPrintQuestions}
      />
      <div className="container no-print review-workspace">
        {actionError && <div className="error-banner">{actionError}</div>}
        {route.kind === 'home' ? (
          <ReviewHomePage
            data={data}
            allMistakeItems={allMistakeItems}
            selectedPrintMistakes={selectedPrintMistakes}
            onTogglePrint={togglePrintMistake}
            onSelectAllPrint={selectAllPrintMistakes}
            onClearPrintSelection={clearPrintMistakes}
          />
        ) : route.kind === 'variation' ? (
          <ReviewVariationPage
            item={detailItem}
            practiceState={practiceState}
            onBack={() => navigate(`/review/mistake/${route.answerId}`)}
          />
        ) : (
          <ReviewMistakePage
            item={detailItem}
            practiceState={practiceState}
            onBack={() => navigate('/review')}
          />
        )}
      </div>
    </>
  );
}

function ReviewHomePage({
  data,
  allMistakeItems,
  selectedPrintMistakes,
  onTogglePrint,
  onSelectAllPrint,
  onClearPrintSelection,
}: {
  data: ReviewData;
  allMistakeItems: ReviewMistakeWithGroup[];
  selectedPrintMistakes: Set<number>;
  onTogglePrint: (answerId: number) => void;
  onSelectAllPrint: () => void;
  onClearPrintSelection: () => void;
}) {
  const center = data.review_center || emptyReviewCenter();
  const progress = getClearanceProgress(data);
  const primary = center.primary_focus;

  return (
    <>
      <ReviewHeader
        title="错题本"
        subtitle="把错题变成下一次做对的证据。"
      />

      {allMistakeItems.length === 0 ? (
        <ReviewEmptyState
          title="暂无待复盘错题"
          description="继续保持当前节奏，新的错题会在练习后自动进入这里。"
        />
      ) : (
        <div className="review-tablet-grid">
          <aside className="review-control-panel">
            <div className="review-control-header">
              <span>复盘控制面板</span>
              <h2>错题复盘</h2>
            </div>
            <div className="review-control-section review-control-priority">
              <div className="review-control-section-title">本轮重点</div>
              <div className="review-priority-card">
                <div className="review-priority-heading">
                  <strong>{primary?.error_name || '错题池'}</strong>
                  <span>{primary ? '优先处理' : '待开始'}</span>
                </div>
                <p>
                  {primary
                    ? `${primary.count} 道错题集中在这一类，先从这里开始清理。`
                    : '先选择一道错题开始复盘。'}
                </p>
              </div>
              <div className="review-control-stats-grid" aria-label="错题复盘统计">
                <ControlStat label="待复盘" value={center.total_pending || allMistakeItems.length} />
                <ControlStat label="已清除" value={data.clearance_progress.reviewed} />
                <ControlStat label="清零进度" value={`${progress}%`} />
                <ControlStat label="错因类型" value={center.error_groups.length} />
              </div>
            </div>
            <div className="review-control-section review-control-steps">
              <div className="review-control-section-title">复盘流程</div>
              <ReviewPathSteps />
            </div>
          </aside>

          <main className="review-main-panel review-mistake-pool-panel">
            <section className="review-mistake-pool-header">
              <div className="review-mistake-pool-heading">
                <span className="review-section-eyebrow">错题池</span>
                <h2>待复盘错题</h2>
              </div>
              <ReviewPrintToolbar
                selectedCount={selectedPrintMistakes.size}
                totalCount={allMistakeItems.length}
                onSelectAll={onSelectAllPrint}
                onClearSelection={onClearPrintSelection}
                className="review-pool-print-toolbar"
              />
            </section>
            <section className="review-mistake-pool review-scroll-panel" aria-label="待复盘错题">
              {data.groups.filter(group => group.mistakes.length > 0).map(group => (
                <details key={group.kp_id} className="review-mistake-group" open>
                  <summary>
                    <span className="review-mistake-group-title">
                      <span className="review-mistake-group-arrow">▼</span>
                      {canonicalKpName(group.kp_id, group.kp_name)}
                    </span>
                    <span className="review-mistake-count">{group.mistakes.length} 题</span>
                  </summary>
                  <div className="review-mistake-row-list">
                    {group.mistakes.map(mistake => (
                      <div key={mistake.answer_id} className="review-mistake-row">
                        <label className="mistake-print-check review-row-print-check">
                          <input
                            type="checkbox"
                            checked={selectedPrintMistakes.has(mistake.answer_id)}
                            onChange={() => onTogglePrint(mistake.answer_id)}
                          />
                          <span>打印</span>
                        </label>
                        <Link
                          to={`/review/mistake/${mistake.answer_id}`}
                          className="review-mistake-row-link"
                        >
                          <span className="review-mistake-row-title"><LatexSpan text={truncateText(mistake.stem_text, 80)} /></span>
                          {mistake.process_grading?.answer_source === 'teacher_paper' && <span className="history-tag">
                            纸质作业{mistake.process_grading.score != null && mistake.process_grading.max_score != null
                              ? ` ${mistake.process_grading.score}/${mistake.process_grading.max_score} 分` : ''}
                          </span>}
                          {mistake.lesson_video && <span className="history-tag">有视频讲解</span>}
                          <span className="review-mistake-row-date">{formatReviewDate(mistake.created_at)}</span>
                        </Link>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </section>
          </main>
        </div>
      )}
    </>
  );
}

function ReviewMistakePage({
  item,
  practiceState,
  onBack,
}: {
  item: ReviewMistakeWithGroup | null;
  practiceState: ReviewPracticeState;
  onBack: () => void;
}) {
  return (
    <>
      <ReviewHeader
        title="错题复盘"
        subtitle="这是单道错题的完整复盘页。"
        onBack={onBack}
        backLabel="返回"
        className="review-single-header"
      />
      {item ? (
        <div className="review-single-detail review-question-card review-single-question-card">
          <div className="review-practice-panel review-mistake-detail">
            <ReviewMistakeDetail item={item} practiceState={practiceState} />
          </div>
        </div>
      ) : (
        <ReviewEmptyState title="没有找到指定错题" description="这道错题可能已经清除，或不属于当前账号。" />
      )}
    </>
  );
}

function ReviewMistakeDetail({
  item,
  practiceState,
}: {
  item: ReviewMistakeWithGroup;
  practiceState: ReviewPracticeState;
}) {
  const answerId = item.mistake.answer_id;
  return (
    <div className="review-mistake-detail-workspace">
      <WrongQuestionCard
        mistake={item.mistake}
        isRetrying={practiceState.retrying.has(answerId)}
        isCleared={practiceState.clearedMistakes.has(answerId)}
        onRetry={() => practiceState.onRetry(answerId)}
      />
    </div>
  );
}

function ReviewVariationPage({
  item,
  practiceState,
  onBack,
}: {
  item: ReviewMistakeWithGroup | null;
  practiceState: ReviewPracticeState;
  onBack: () => void;
}) {
  if (!item) {
    return <ReviewEmptyState title="没有找到指定错题" description="这道错题可能已经清除，或不属于当前账号。" />;
  }
  const answerId = item.mistake.answer_id;
  const question = practiceState.variationQuestions[answerId]?.[0]?.question || practiceState.similarQuestions[answerId] || null;
  if (!question) {
    return (
      <>
        <ReviewEmptyState
          title={practiceState.retrying.has(answerId) ? '正在准备变式题' : '暂无可用变式题'}
          description={practiceState.retrying.has(answerId) ? '正在为这道错题生成一道同类练习。' : '请返回错题复盘页后重新尝试。'}
        />
        <button type="button" className="page-back-button" onClick={onBack}>返回错题复盘</button>
      </>
    );
  }
  const result = practiceState.retryResults[answerId];
  return (
    <QuestionSessionRunner
      key={practiceState.attemptKeyFor(answerId)}
      persistenceKey={practiceState.attemptKeyFor(answerId)}
      onAbandon={() => practiceState.onAbandon(answerId)}
      title="做变式题"
      subtitle="做对这道变式题即可完成本题复盘。"
      printTitle="错题变式题"
      questions={[question]}
      currentIndex={0}
      answeredCount={result ? 1 : 0}
      progressForQuestion={() => ({ answered: !!result, correct: result?.is_correct })}
      resultForQuestion={() => result}
      onBack={onBack}
      onGoToQuestion={() => {}}
      showPaperBatch={false}
      onTogglePaperBatch={() => {}}
      onBatchGraded={() => {}}
      onAnswer={(questionId, answer) => practiceState.onSubmitRetry(answerId, questionId, answer)}
      onAnswered={(_, retryResult) => practiceState.onAnsweredRetry(answerId, retryResult)}
      getTimeSpentMs={() => practiceState.getRetryTimeSpentMs(answerId)}
      showQuestionProgressNav={false}
      lastAction={result && !result.is_correct ? (
        <button
          type="button"
          className="question-workspace-nav-button question-workspace-nav-button-primary"
          disabled={practiceState.retrying.has(answerId)}
          onClick={() => practiceState.onRetry(answerId)}
        >
          {practiceState.retrying.has(answerId) ? '正在准备...' : '再练一道'}
        </button>
      ) : null}
    />
  );
}

function ControlStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="review-control-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ReviewPathSteps() {
  const steps = [
    { label: '发现错题', state: 'done' },
    { label: '定位错因', state: 'current' },
    { label: '修正解法', state: 'upcoming' },
    { label: '变式确认', state: 'upcoming' },
    { label: '清除错题', state: 'upcoming' },
  ];

  return (
    <ol className="review-path-steps" aria-label="错题复盘步骤">
      {steps.map((step, index) => (
        <li key={step.label} className={`is-${step.state}`}>
          <span className="review-path-marker">{index + 1}</span>
          <span className="review-path-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function parseReviewRoute(pathname: string): ReviewRoute {
  const variationMatch = pathname.match(/^\/review\/mistake\/(\d+)\/variation/);
  if (variationMatch) return { kind: 'variation', answerId: Number(variationMatch[1]) };
  const mistakeMatch = pathname.match(/^\/review\/mistake\/(\d+)/);
  if (mistakeMatch) return { kind: 'mistake', answerId: Number(mistakeMatch[1]) };
  return { kind: 'home' };
}

function mistakeToPrintableQuestion(mistake: ReviewMistake): Question {
  return {
    id: mistake.question_id,
    stem_text: mistake.stem_text,
    question_type: mistake.question_type || 'problem_solving',
    options: mistake.options || [],
    images: mistake.images || [],
    answer_image_paths: getReviewAnswerImagePaths(mistake),
    given_answer: mistake.given_answer,
  };
}

function getClearanceProgress(data: ReviewData) {
  const total = data.clearance_progress.total;
  if (total <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, data.clearance_progress.reviewed / total * 100)));
}

function formatReviewDate(value?: string | null) {
  if (!value) return '最近';
  const [date] = value.split('T');
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return value;
  return `${year}/${Number(month)}/${Number(day)}`;
}

function truncateText(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function emptyReviewCenter(): ReviewCenter {
  return {
    total_pending: 0,
    primary_focus: null,
    error_groups: [],
    review_steps: [],
    stage_counts: {},
  };
}
