import type { TopicPracticeContext } from '../types';
import { usePracticeExitGuard, usePracticeSubmissionActivity } from './PracticeExitGuard';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import PaperBatchGradingPanel from './PaperBatchGradingPanel';
import PrintableQuestionSet from './PrintableQuestionSet';
import type { HandwritingSnapshot } from './handwriting/HandwritingCanvas';
import type { PhotoUploadDraft } from './PhotoUpload';
import QuestionCard from './QuestionCard';
import { QuestionBottomBar, QuestionHeaderBar, QuestionProgressNav } from './question-workspace';
import { api } from '../api/client';
import { getStudentId } from '../api/studentIdentity';
import {
  HANDWRITING_BACKGROUND_IMAGE_ERROR,
  handwritingSnapshotToFile,
} from '../utils/handwritingExport';
import { runLimitedConcurrency } from '../utils/limitedConcurrency';
import { attachHandwritingProcessEvidence } from '../utils/processEvidence';
import { collectQuestionImageUrls, preloadImageUrls } from '../utils/questionImages';
import type { SelfReviewDraft } from '../utils/selfReview';
import type { Question, SubmitResult } from '../types';
import {PracticeAttemptContext,TeacherPaperAttemptContext,TopicSubmissionContext,optionalAttemptScope,optionalPaperSubmissionScope} from './PracticeAttemptContext';
import {discardPracticeAttempt,loadAttemptResults,loadPracticeDrafts,savePracticeDrafts,reportPracticeSaveError,PRACTICE_SAVE_ERROR} from '../utils/practicePersistence';

const DEFERRED_GRADING_CONCURRENCY = 3;

export interface QuestionProgressState {
  answered: boolean;
  correct?: boolean;
}

export interface DeferredGradingProgress {
  completed: number;
  total: number;
}

interface DeferredAnswerSummary {
  choice: number;
  handwriting: number;
  photo: number;
  selfReview: number;
  graded: number;
  unanswered: number;
}

interface QuestionSessionRunnerProps {
  persistenceKey?: string;
  title: string;
  subtitle: string;
  printTitle: string;
  questions: Question[];
  currentIndex: number;
  answeredCount: number;
  progressForQuestion: (questionId: string) => QuestionProgressState;
  resultForQuestion?: (questionId: string) => SubmitResult | undefined;
  statusForQuestion?: (questionId: string) => ReactNode;
  onBack: () => void;
  onGoToQuestion: (index: number) => void;
  showPaperBatch: boolean;
  onTogglePaperBatch: () => void;
  onBatchGraded: (results: Record<string, SubmitResult>) => void;
  onAnswer?: (questionId: string, answer: string) => Promise<SubmitResult>;
  onAnswered?: (questionId: string, result: SubmitResult) => void;
  collectMode?: boolean;
  deferredGrading?: boolean;
  wholePaper?: boolean;
  onCollect?: (questionId: string, answer: string) => void;
  getTimeSpentMs?: () => number;
  disabledCurrent?: boolean;
  error?: string | null;
  lastAction: ReactNode;
  onAllGraded?: () => void;
  incompleteMessage?: ReactNode;
  showQuestionProgressNav?: boolean;
  supplementaryAction?: ReactNode;
  teacherPaperAttemptId?: string;
  topicContext?: TopicPracticeContext;
  onBeforeDeferredGrading?: () => Promise<void>;
  readOnly?: boolean;
  submitted?: boolean;
  onAbandon?: () => void;
}

function handwritingSnapshotKey(snapshot: HandwritingSnapshot) {
  const strokes = snapshot.strokes || [];
  const pointCount = strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
  const lastStroke = strokes[strokes.length - 1];
  const lastPoint = lastStroke?.points[lastStroke.points.length - 1];
  const viewport = snapshot.viewport || { offsetX: 0, offsetY: 0, scale: 1 };
  const backgroundImage = snapshot.backgroundImage;
  return [
    strokes.length,
    pointCount,
    lastStroke?.tool || '',
    lastStroke?.width || 0,
    lastPoint ? `${lastPoint.x}:${lastPoint.y}:${lastPoint.t}` : '',
    `${viewport.offsetX}:${viewport.offsetY}:${viewport.scale}`,
    backgroundImage ? `${backgroundImage.imagePath}:${backgroundImage.x}:${backgroundImage.y}:${backgroundImage.width}:${backgroundImage.height}` : '',
  ].join('|');
}

function formatDeferredAnswerSummary(summary: DeferredAnswerSummary, total: number) {
  const parts = [`已作答 ${total - summary.unanswered}/${total}`];
  if (summary.choice) parts.push(`选择 ${summary.choice}`);
  if (summary.handwriting) parts.push(`画布 ${summary.handwriting}`);
  if (summary.photo) parts.push(`照片 ${summary.photo}`);
  if (summary.selfReview) parts.push(`自评 ${summary.selfReview}`);
  if (summary.graded) parts.push(`已批改 ${summary.graded}`);
  if (summary.unanswered) parts.push(`未作答 ${summary.unanswered}`);
  return parts.join(' · ');
}

export default function QuestionSessionRunner({
  title,
  subtitle,
  printTitle,
  questions,
  currentIndex,
  answeredCount,
  progressForQuestion,
  resultForQuestion: externalResultForQuestion,
  statusForQuestion,
  onBack,
  onGoToQuestion,
  showPaperBatch,
  onTogglePaperBatch,
  onBatchGraded,
  onAnswer,
  onAnswered,
  collectMode,
  deferredGrading,
  wholePaper = false,
  onCollect,
  getTimeSpentMs,
  disabledCurrent,
  error,
  lastAction,
  onAllGraded,
  incompleteMessage,
  showQuestionProgressNav = true,
  persistenceKey,
  supplementaryAction,
  teacherPaperAttemptId,
  topicContext,
  onBeforeDeferredGrading,
  readOnly = false,
  submitted = false,
  onAbandon,
}: QuestionSessionRunnerProps) {
  const [restoredResults]=useState(()=>persistenceKey ? loadAttemptResults(persistenceKey) : {});
  const resultForQuestion=(id:string)=>externalResultForQuestion?.(id) || restoredResults[id];
  const question = questions[currentIndex];
  const total = questions.length;
  const nextQuestion = questions[currentIndex + 1];
  const questionIdsKey = useMemo(() => questions.map(item => item.id).join('|'), [questions]);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [photoDrafts, setPhotoDrafts] = useState<Record<string, PhotoUploadDraft>>({});
  const [handwritingDrafts, setHandwritingDrafts] = useState<Record<string, HandwritingSnapshot>>({});
  const [selfReviewDrafts, setSelfReviewDrafts] = useState<Record<string, SelfReviewDraft>>({});
  const [draftBackgroundImageIds, setDraftBackgroundImageIds] = useState<Record<string, string | null>>({});
  const [deferredGradingLoading, setDeferredGradingLoading] = useState(false);
  const [deferredGradingConfirming, setDeferredGradingConfirming] = useState(false);
  const [deferredGradingError, setDeferredGradingError] = useState<string | null>(null);
  const [deferredGradingProgress, setDeferredGradingProgress] = useState<DeferredGradingProgress>({
    completed: 0,
    total: 0,
  });
  const photoDraftsRef = useRef(photoDrafts);
  const reportedAllGradedKeyRef = useRef<string | null>(null);
  const [draftsRestored,setDraftsRestored]=useState(!persistenceKey);
  const [saveWarning,setSaveWarning]=useState(false);
  const [savingDraft,setSavingDraft]=useState(false);
  const persistRef=useRef<()=>void>(()=>{});
  const saveVersionRef=useRef(0);
  const mountedRef=useRef(true);
  const gradingLockRef=useRef(false);
  const [ownerToken]=useState(()=>localStorage.getItem('openphysics.student_token'));
  const isCurrentAttempt=()=>mountedRef.current && localStorage.getItem('openphysics.student_token')===ownerToken;

  useEffect(()=>{
    mountedRef.current=true;
    const failed=()=>setSaveWarning(true);
    window.addEventListener(PRACTICE_SAVE_ERROR,failed);
    return()=>{
      persistRef.current();
      mountedRef.current=false;
      window.removeEventListener(PRACTICE_SAVE_ERROR,failed);
    };
  },[]);

  useEffect(()=>{
    if(!persistenceKey)return;
    let active=true;
    void loadPracticeDrafts(persistenceKey).then(draft=>{
      if(!active || !draft)return;
      setDraftAnswers(draft.answers || {});
      setHandwritingDrafts(draft.handwriting || {});
      setSelfReviewDrafts(draft.selfReviews || {});
      setDraftBackgroundImageIds(draft.backgrounds || {});
      setPhotoDrafts(Object.fromEntries(Object.entries(draft.photos || {}).map(([id,file])=>[
        id,{file,previewUrl:URL.createObjectURL(file)},
      ])));
    }).catch(()=>{if(active){setSaveWarning(true);reportPracticeSaveError();}}).finally(()=>{if(active)setDraftsRestored(true);});
    return()=>{active=false;};
  },[persistenceKey]);

  useEffect(()=>{
    if(!persistenceKey || !draftsRestored)return;
    const draft={answers:draftAnswers,photos:Object.fromEntries(Object.entries(photoDrafts).map(([id,value])=>[id,value.file])),
      handwriting:handwritingDrafts,selfReviews:selfReviewDrafts,backgrounds:draftBackgroundImageIds};
    const version=++saveVersionRef.current;
    const persist=()=>{
      void savePracticeDrafts(persistenceKey,draft).catch(()=>{if(mountedRef.current)setSaveWarning(true);})
        .finally(()=>{if(mountedRef.current && saveVersionRef.current===version)setSavingDraft(false);});
    };
    persistRef.current=persist;
    setSavingDraft(true);
    const timer=window.setTimeout(persist,150);
    return()=>window.clearTimeout(timer);
  },[persistenceKey,draftsRestored,draftAnswers,photoDrafts,handwritingDrafts,selfReviewDrafts,draftBackgroundImageIds]);

  useEffect(()=>{
    if(!saveWarning && !savingDraft)return;
    const beforeUnload=(event:BeforeUnloadEvent)=>{persistRef.current();event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',beforeUnload);
    return()=>window.removeEventListener('beforeunload',beforeUnload);
  },[saveWarning,savingDraft]);

  useEffect(() => {
    if (!nextQuestion) return;
    preloadImageUrls(collectQuestionImageUrls(nextQuestion));
  }, [nextQuestion]);

  useEffect(() => {
    const validIds = new Set(questionIdsKey.split('|').filter(Boolean));
    setDraftAnswers(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([questionId]) => validIds.has(questionId)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    setPhotoDrafts(prev => {
      const next: Record<string, PhotoUploadDraft> = {};
      let changed = false;
      Object.entries(prev).forEach(([questionId, draft]) => {
        if (validIds.has(questionId)) {
          next[questionId] = draft;
        } else {
          URL.revokeObjectURL(draft.previewUrl);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setHandwritingDrafts(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([questionId]) => validIds.has(questionId)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    setSelfReviewDrafts(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([questionId]) => validIds.has(questionId)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    setDraftBackgroundImageIds(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([questionId]) => validIds.has(questionId)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [questionIdsKey]);

  useEffect(() => {
    photoDraftsRef.current = photoDrafts;
  }, [photoDrafts]);

  useEffect(() => () => {
    Object.values(photoDraftsRef.current).forEach(draft => URL.revokeObjectURL(draft.previewUrl));
  }, []);

  const handleDraftChange = (questionId: string, answer: string) => {
    setDraftAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const handleCollect = (questionId: string, answer: string) => {
    setDraftAnswers(prev => ({ ...prev, [questionId]: answer }));
    onCollect?.(questionId, answer);
  };

  const handlePhotoDraftChange = (questionId: string, draft: PhotoUploadDraft | null) => {
    setPhotoDrafts(prev => {
      const current = prev[questionId];
      if (current && current.previewUrl !== draft?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      if (!draft) {
        if (!current) return prev;
        const { [questionId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [questionId]: draft };
    });
  };

  const handleHandwritingDraftChange = (questionId: string, draft: HandwritingSnapshot) => {
    setHandwritingDrafts(prev => (
      prev[questionId] && handwritingSnapshotKey(prev[questionId]) === handwritingSnapshotKey(draft)
        ? prev
        : { ...prev, [questionId]: draft }
    ));
  };

  const handleSelfReviewDraftChange = (questionId: string, draft: SelfReviewDraft | null) => {
    setSelfReviewDrafts(prev => {
      if (!draft) {
        if (!(questionId in prev)) return prev;
        const { [questionId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [questionId]: draft };
    });
  };

  const handleDraftBackgroundImageChange = (questionId: string, imageId: string | null) => {
    setDraftBackgroundImageIds(prev => {
      if (!imageId) {
        if (!(questionId in prev)) return prev;
        const { [questionId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [questionId]: imageId };
    });
  };

  const isQuestionReadyForDeferredGrading = (item: Question) => {
    if (resultForQuestion?.(item.id)) return true;
    if (item.options?.length) return !!draftAnswers[item.id];
    if (selfReviewDrafts[item.id]) return true;
    const handwritingDraft = handwritingDrafts[item.id];
    return !!photoDrafts[item.id] || !!(handwritingDraft?.strokes?.length);
  };

  const isQuestionGraded = (item: Question) => !!resultForQuestion?.(item.id);
  const shouldUseDeferredGrading = !!collectMode && !!deferredGrading;
  const pendingDeferredQuestions = shouldUseDeferredGrading
    ? questions.filter(item => !resultForQuestion?.(item.id))
    : [];
  const hasDeferredAnswersPending = pendingDeferredQuestions.length > 0;
  const allDeferredAnswersGraded = shouldUseDeferredGrading
    && !hasDeferredAnswersPending
    && questions.some(item => isQuestionGraded(item));
  const allQuestionsGraded = questions.length > 0 && questions.every(item => isQuestionGraded(item));
  const canSubmitDeferred = hasDeferredAnswersPending && !deferredGradingLoading;
  const isLastQuestion = currentIndex === total - 1;
  const deferredAnswerSummary = (() => {
    if (!shouldUseDeferredGrading || allDeferredAnswersGraded) return null;
    const summary = questions.reduce<DeferredAnswerSummary>((counts, item) => {
      if (resultForQuestion?.(item.id)) counts.graded += 1;
      else if (item.options?.length) {
        if (draftAnswers[item.id]) counts.choice += 1;
        else counts.unanswered += 1;
      } else if (selfReviewDrafts[item.id]) counts.selfReview += 1;
      else if (photoDrafts[item.id]) counts.photo += 1;
      else if (handwritingDrafts[item.id]?.strokes?.length) counts.handwriting += 1;
      else counts.unanswered += 1;
      return counts;
    }, {
      choice: 0,
      handwriting: 0,
      photo: 0,
      selfReview: 0,
      graded: 0,
      unanswered: 0,
    });
    return {
      text: formatDeferredAnswerSummary(summary, total),
      complete: summary.unanswered === 0,
      unansweredNumbers: questions.flatMap((item, index) => isQuestionReadyForDeferredGrading(item) ? [] : [index + 1]),
    };
  })();

  useEffect(() => {
    if (!allQuestionsGraded || !draftsRestored || deferredGradingLoading) {
      reportedAllGradedKeyRef.current = null;
      return;
    }
    if (!onAllGraded || reportedAllGradedKeyRef.current === questionIdsKey) return;
    reportedAllGradedKeyRef.current = questionIdsKey;
    onAllGraded();
  }, [allQuestionsGraded, onAllGraded, questionIdsKey,draftsRestored, deferredGradingLoading]);

  const headerExtraAction = shouldUseDeferredGrading && !allDeferredAnswersGraded ? (
    <button
      type="button"
      onClick={() => setDeferredGradingConfirming(true)}
      disabled={!canSubmitDeferred}
      className={[
        'question-workspace-nav-button',
        'question-workspace-nav-button-primary',
        'question-workspace-header-submit',
        canSubmitDeferred ? '' : 'is-disabled',
      ].filter(Boolean).join(' ')}
    >
      {deferredGradingLoading ? 'AI 批改中' : wholePaper ? (questions.some(isQuestionGraded) ? '重试未完成批改' : '提交整卷') : '提交批改'}
    </button>
  ) : (shouldUseDeferredGrading || isLastQuestion) ? lastAction : null;

  const handleSubmitDeferredGrading = async () => {
    if (!shouldUseDeferredGrading || !hasDeferredAnswersPending || gradingLockRef.current || !isCurrentAttempt()) return;
    gradingLockRef.current=true;
    setDeferredGradingConfirming(false);
    setDeferredGradingLoading(true);
    setDeferredGradingError(null);
    const pendingQuestions = pendingDeferredQuestions;
    const alreadyGraded = questions.length - pendingQuestions.length;
    setDeferredGradingProgress({ completed: alreadyGraded, total: questions.length });
    try {
      await onBeforeDeferredGrading?.();
      if (!isCurrentAttempt()) return;
      await runLimitedConcurrency(pendingQuestions.map(item => async () => {
        let succeeded = false;
        try {
          if(!isCurrentAttempt())return;
          if (item.options?.length) {
            const answer = draftAnswers[item.id] || '';
            if (!onAnswer) return;
            const submitted = await onAnswer(item.id, answer);
            if(!isCurrentAttempt())return;
            let result = submitted;
            try {
              result = await attachHandwritingProcessEvidence(
                submitted,
                item.id,
                handwritingDrafts[item.id],
                getTimeSpentMs?.() ?? 0,
              );
            } catch {
              result = submitted;
            }
            result = { ...result, extracted_answer: result.extracted_answer || answer };
            if(!isCurrentAttempt())return;
            onAnswered?.(item.id, result);
            onCollect?.(item.id, result.extracted_answer || answer);
            succeeded = true;
            return;
          }
          const draft = photoDrafts[item.id];
          const handwritingDraft = handwritingDrafts[item.id];
          const selfReviewDraft = selfReviewDrafts[item.id];
          let result: SubmitResult | null = null;
          if (selfReviewDraft) {
            result = await api.submitSelfReview({
              question_id: item.id,
              ...(topicContext && { topic_context: topicContext }),
              items: selfReviewDraft.items,
              ...(teacherPaperAttemptId && { teacher_paper_attempt_id: teacherPaperAttemptId }),
              time_spent_ms: selfReviewDraft.time_spent_ms,
              target_knowledge_point_id: item.target_knowledge_point_id,
            },...optionalAttemptScope(persistenceKey));
            if(!isCurrentAttempt())return;
            handleSelfReviewDraftChange(item.id, null);
          } else if (draft) {
            result = await api.submitPhoto(
              getStudentId(),
              draft.file,
              item.id,
              getTimeSpentMs?.() ?? 0,
              item.target_knowledge_point_id,
              ...optionalPaperSubmissionScope(persistenceKey, teacherPaperAttemptId, topicContext),
            );
            if(!isCurrentAttempt())return;
            handlePhotoDraftChange(item.id, null);
          } else if (handwritingDraft?.strokes?.length) {
            const selectedBackgroundImageId = draftBackgroundImageIds[item.id];
            if (selectedBackgroundImageId) {
              const selectedBackgroundImagePath = item.images?.find(
                image => image.id === selectedBackgroundImageId,
              )?.image_path;
              if (
                !selectedBackgroundImagePath
                || handwritingDraft.backgroundImage?.imagePath !== selectedBackgroundImagePath
              ) {
                throw new Error(HANDWRITING_BACKGROUND_IMAGE_ERROR);
              }
            }
            const file = await handwritingSnapshotToFile(handwritingDraft, `handwriting-${item.id}.png`);
            if(!isCurrentAttempt())return;
            const timeSpentMs = getTimeSpentMs?.() ?? 0;
            result = await api.submitPhoto(
              getStudentId(),
              file,
              item.id,
              timeSpentMs,
              item.target_knowledge_point_id,
              ...optionalPaperSubmissionScope(persistenceKey, teacherPaperAttemptId, topicContext),
            );
          } else if (onAnswer) {
            result = await onAnswer(item.id, '');
          }
          if (!result || !isCurrentAttempt()) return;
          onAnswered?.(item.id, result);
          onCollect?.(item.id, result.extracted_answer || '');
          succeeded = true;
        } finally {
          if(succeeded && isCurrentAttempt())setDeferredGradingProgress(prev => ({
            completed: Math.min(prev.completed + 1, prev.total),
            total: prev.total,
          }));
        }
      }), DEFERRED_GRADING_CONCURRENCY);
    } catch (e: any) {
      if(isCurrentAttempt())setDeferredGradingError(e.message || '批改失败，请稍后重试');
    } finally {
      gradingLockRef.current=false;
      if(isCurrentAttempt())setDeferredGradingLoading(false);
    }
  };

  usePracticeSubmissionActivity(deferredGradingLoading);
  const requestExit = usePracticeExitGuard({
    unfinished: !readOnly && !submitted && isCurrentAttempt() && questions.some(item => !resultForQuestion(item.id)),
    discard: async () => {
      if (persistenceKey) await discardPracticeAttempt(persistenceKey, true);
      onAbandon?.();
    },
  });

  if(!draftsRestored)return <div className="loading">正在恢复练习进度...</div>;

  return (
    <TopicSubmissionContext.Provider value={topicContext}>
    <PracticeAttemptContext.Provider value={persistenceKey}>
    <TeacherPaperAttemptContext.Provider value={teacherPaperAttemptId ? { id: teacherPaperAttemptId, beforeSubmit: onBeforeDeferredGrading } : undefined}>
      <PrintableQuestionSet
        title={printTitle}
        subtitle={subtitle}
        questions={questions}
      />
      <div className="container question-session-workspace no-print">
        <QuestionHeaderBar
          title={title}
          answeredCount={shouldUseDeferredGrading ? questions.filter(isQuestionReadyForDeferredGrading).length : answeredCount}
          total={total}
          showPaperBatch={showPaperBatch}
          allowPaperBatch={!readOnly && !questions.some(isQuestionGraded)}
          onBack={() => requestExit(onBack)}
          onTogglePaperBatch={onTogglePaperBatch}
          extraAction={<>{supplementaryAction}{headerExtraAction}</>}
        />

        {showPaperBatch && !readOnly && <PaperBatchGradingPanel questions={questions} onGraded={onBatchGraded} />}

        {error && (
          <div className="error-banner" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {showQuestionProgressNav && (
          <QuestionProgressNav
            questions={questions}
            currentIndex={currentIndex}
            progressForQuestion={shouldUseDeferredGrading && !allQuestionsGraded ? id => ({ answered: progressForQuestion(id).answered }) : progressForQuestion}
            onGoToQuestion={onGoToQuestion}
            shouldUseDeferredGrading={shouldUseDeferredGrading}
            isQuestionReadyForDeferredGrading={isQuestionReadyForDeferredGrading}
          />
        )}

        <QuestionBottomBar
          questionId={question?.id}
          statusForQuestion={shouldUseDeferredGrading && !allQuestionsGraded ? undefined : statusForQuestion}
          wholePaper={wholePaper}
          incompleteMessage={incompleteMessage}
          submissionSummary={deferredAnswerSummary}
          deferredGradingLoading={deferredGradingLoading}
          deferredGradingConfirming={deferredGradingConfirming}
          deferredGradingError={deferredGradingError}
          deferredGradingProgress={deferredGradingProgress}
          onCancelDeferredGrading={() => setDeferredGradingConfirming(false)}
          onConfirmDeferredGrading={handleSubmitDeferredGrading}
        >
          {question && (
            <QuestionCard
              key={question.id}
              question={question}
              onAnswer={onAnswer}
              onAnswered={onAnswered}
              externalResult={shouldUseDeferredGrading && !allQuestionsGraded ? undefined : resultForQuestion?.(question.id)}
              reviewMode={readOnly || (shouldUseDeferredGrading && allQuestionsGraded)}
              collectMode={collectMode}
              onCollect={handleCollect}
              initialAnswer={resultForQuestion?.(question.id)?.extracted_answer || draftAnswers[question.id]}
              onDraftChange={handleDraftChange}
              photoDraft={photoDrafts[question.id] || null}
              handwritingDraft={handwritingDrafts[question.id] || null}
              selfReviewDraft={selfReviewDrafts[question.id] || null}
              draftBackgroundImageId={draftBackgroundImageIds[question.id] || null}
              onPhotoDraftChange={handlePhotoDraftChange}
              onHandwritingDraftChange={handleHandwritingDraftChange}
              onSelfReviewDraftChange={handleSelfReviewDraftChange}
              onDraftBackgroundImageChange={handleDraftBackgroundImageChange}
              deferredGrading={shouldUseDeferredGrading}
              getTimeSpentMs={getTimeSpentMs}
              disabled={readOnly || !!disabledCurrent || deferredGradingLoading}
            />
          )}
        </QuestionBottomBar>
      </div>
    </TeacherPaperAttemptContext.Provider>
    </PracticeAttemptContext.Provider>
    </TopicSubmissionContext.Provider>
  );
}
