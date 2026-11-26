import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { getStudentId, getStudentProfile } from '../api/studentIdentity';
import QuestionSessionRunner from '../components/QuestionSessionRunner';
import SessionResultDialog from '../components/SessionResultDialog';
import AccountAccessPanel from '../components/AccountAccessPanel';
import { getPracticeModeCopy, parsePracticeMode } from '../utils/practiceModes';
import { buildPracticeSummary } from '../utils/practiceSummary';
import { navigateBackToPreviousPage } from '../utils/navigation';
import { buildSubmittedDiagnosticAnswers } from '../utils/submittedDiagnosticAnswers';
import { canEnterLearningArea, isLearningAccessError } from '../utils/learningAccess';
import { useQuestionSessionState } from '../hooks/useQuestionSessionState';
import {loadPracticeRecord} from '../utils/practicePersistence';
import { hasCompletedKpAssessment, hasCompletedQuestionSet } from '../utils/kpPracticeLifecycle';
import type { KpDiagnosticResult, LearnBundle, PracticeSession } from '../types';

export default function KpCheckPage() {
  const location=useLocation();
  return <KpCheckEntry key={location.search}/>;
}

function KpCheckEntry() {
  const [params] = useSearchParams();
  const [saved] = useState(() => loadPracticeRecord(getStudentId(), `kp-check:${params}`));
  const kpId = params.get('kp') || '';
  if (parsePracticeMode(params.get('mode')) !== 'practice' && hasCompletedKpAssessment(saved)) {
    const next = new URLSearchParams({ kp: kpId, count: '5', mode: 'practice' });
    return <Navigate to={`/learn/check?${next}`} replace state={{ from: '/sync', restoreKpId: kpId }} />;
  }
  return <KpCheckSession />;
}

function KpCheckSession() {
  const [searchParams] = useSearchParams();
  const kpId = searchParams.get('kp') || '';
  const mode = parsePracticeMode(searchParams.get('mode'));
  const copy = getPracticeModeCopy(mode);
  const isAssessment = mode === 'check' || mode === 'diagnostic';
  const requestedCount = Number(searchParams.get('count') || 3);
  const checkCount = Number.isFinite(requestedCount)
    ? Math.max(1, Math.min(requestedCount, 5))
    : 3;
  const studentId = getStudentId();
  const persistenceScope=`kp-check:${searchParams.toString()}`;
  const [restored]=useState(()=>loadPracticeRecord(studentId,persistenceScope));
  const resumeSaved = !!restored?.payload.session && (isAssessment || !hasCompletedQuestionSet(restored));
  const canUseLearning = canEnterLearningArea(getStudentProfile());
  const navigate = useNavigate();
  const location = useLocation();

  const [bundle, setBundle] = useState<LearnBundle | null>((restored?.payload.bundle as LearnBundle) || null);
  const [session, setSession] = useState<PracticeSession | null>((restored?.payload.session as PracticeSession) || null);
  const [diagnosticResult, setDiagnosticResult] = useState<KpDiagnosticResult | null>((restored?.payload.diagnosticResult as KpDiagnosticResult) || null);
  const [resultOpen, setResultOpen] = useState(false);
  const [loading, setLoading] = useState(canUseLearning && !resumeSaved);
  const [submittingDiagnostic, setSubmittingDiagnostic] = useState(false);
  const [diagnosticResultError, setDiagnosticResultError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const diagnosticFinalizingRef = useRef(false);
  const requestGeneration=useRef(0);
  useEffect(() => () => {
    requestGeneration.current += 1;
    diagnosticFinalizingRef.current = false;
  }, []);
  const submitAnswer = useCallback(async (questionId: string, answer: string, timeSpentMs: number, submissionId?: string) => (
    api.submitAnswer(studentId, {
      question_id: questionId,
      given_answer: answer,
      time_spent_ms: timeSpentMs,
      target_knowledge_point_id: kpId,
      ...(submissionId && {submission_id:submissionId}),
    })
  ), [kpId, studentId]);
  const {
    answers,
    collectedAnswers,
    currentIdx,
    showPaperBatch,
    resetSessionState,
    goToQuestion,
    togglePaperBatch,
    handleAnswer,
    handleAnsweredResult,
    handleBatchGraded,
    handleCollectAnswer,
    getQuestionTimeSpentMs,
    attemptId,
    persistSessionPayload,
  } = useQuestionSessionState({ submitAnswer,studentId,persistenceScope });

  const fetchData = useCallback(async (forceNew = false) => {
    if (!canUseLearning) {
      setLoading(false);
      return;
    }
    if (!kpId) {
      setError('未指定知识点');
      setLoading(false);
      return;
    }

    if(!forceNew && resumeSaved && restored?.payload.bundle) return;

    const generation=++requestGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const [learnBundle, practiceSession] = await Promise.all([
        api.getLearnBundle(kpId, studentId),
        isAssessment
          ? api.diagnoseKp(kpId, checkCount, studentId)
          : api.getPracticeSession(studentId, kpId, checkCount),
      ]);
      if(generation!==requestGeneration.current)return;
      setBundle(learnBundle);
      setSession(practiceSession);
      setDiagnosticResult(null);
      setResultOpen(false);
      setDiagnosticResultError(null);
      diagnosticFinalizingRef.current = false;
      resetSessionState();
      persistSessionPayload({bundle:learnBundle,session:practiceSession});
    } catch (e: any) {
      if(generation!==requestGeneration.current)return;
      setError(e.message || `${copy.title}加载失败`);
    } finally {
      if(generation===requestGeneration.current)setLoading(false);
    }
  }, [canUseLearning, checkCount, copy.title, isAssessment, kpId, resetSessionState, studentId,restored,resumeSaved,persistSessionPayload]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleFinalizeDiagnostic = useCallback(async () => {
    if (
      !session
      || session.questions.length === 0
      || !isAssessment
      || diagnosticResult
      || diagnosticFinalizingRef.current
      || !session.questions.every(question => !!answers[question.id])
    ) return;
    diagnosticFinalizingRef.current = true;
    const generation = requestGeneration.current;
    setSubmittingDiagnostic(true);
    setDiagnosticResultError(null);
    try {
      const result = await api.getKpSubmittedDiagnosticFeedback(
        kpId,
        buildSubmittedDiagnosticAnswers(answers),
        studentId,
      );
      if (generation !== requestGeneration.current) return;
      setDiagnosticResult(result);
      persistSessionPayload({bundle,session,diagnosticResult:result});
      setResultOpen(true);
    } catch (e: any) {
      if (generation !== requestGeneration.current) return;
      setDiagnosticResultError(e.message || '评估结果生成失败，请重试');
    } finally {
      if (generation === requestGeneration.current) {
        diagnosticFinalizingRef.current = false;
        setSubmittingDiagnostic(false);
      }
    }
  }, [answers, diagnosticResult, isAssessment, kpId, session, studentId,bundle,persistSessionPayload]);

  // Restored answers can already be graded before the runner mounts. Finalize
  // from page state as well, including React's development effect remount.
  useEffect(() => {
    if (!loading) void handleFinalizeDiagnostic();
  }, [loading, handleFinalizeDiagnostic]);

  const goBack = () => {
    navigateBackToPreviousPage(navigate, location, `/learn?kp=${kpId}`, {
      state: { restoreKpId: kpId },
    });
  };

  const restartPractice = () => {
    setResultOpen(false);
    setDiagnosticResult(null);
    void fetchData(true);
  };

  if (!canUseLearning) {
    return (
      <div className="container question-session-workspace no-print">
        <div className="page-header">
          <h1>{copy.title}</h1>
          <p>{copy.empty}</p>
        </div>
        <AccountAccessPanel
          features={['选择题作答', '纸笔批改', 'AI 批改', '错因分析']}
        />
      </div>
    );
  }

  if (loading) return <div className="loading">{copy.loading}</div>;
  if (isLearningAccessError(error)) return (
    <div className="container question-session-workspace no-print">
      <div className="page-header">
        <h1>{copy.title}</h1>
        <p>请使用有效账号登录后继续学习。</p>
      </div>
      <AccountAccessPanel
        title="账号不可用，请重新登录或联系部署管理员。"
        description="账号不可用，请重新登录或联系部署管理员。"
        features={['选择题作答', '纸笔批改', 'AI 批改', '错因分析']}
      />
    </div>
  );
  if (error) return (
    <div className="container">
      <div className="error-banner">{error}</div>
      <div className="page-action-group" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="page-back-button" onClick={goBack}>返回</button>
        <button onClick={()=>void fetchData(true)} style={{
          padding: '8px 16px',
          borderRadius: 4,
          border: '1px solid #d9d9d9',
          background: '#fff',
          cursor: 'pointer',
          fontSize: 13,
        }}>重试</button>
      </div>
    </div>
  );
  if (!session || session.questions.length === 0) {
    return (
      <div className="container">
        <div className="page-header">
          <h1>{copy.title}</h1>
          <p>{copy.empty}</p>
        </div>
        <button type="button" className="page-back-button" onClick={goBack}>返回</button>
      </div>
    );
  }

  const total = session.questions.length;
  const answeredCount = Object.keys(answers).length;
  const allAnswered = session.questions.every(q => !!answers[q.id]);
  const summary = buildPracticeSummary(answers);
  const syncReturnState = { from: '/sync', restoreKpId: kpId };
  const recommendation = diagnosticResult?.recommendation === 'mastered'
    ? { tone: 'mastered' as const, label: '已掌握' }
    : diagnosticResult?.recommendation === 'practice'
      ? { tone: 'practice' as const, label: '有基础，需巩固' }
      : { tone: 'study' as const, label: '建议先学习' };
  const masteryMeta = diagnosticResult
    && Math.abs(diagnosticResult.mastery_after - diagnosticResult.mastery_before) >= 0.005
    ? `掌握度：${(diagnosticResult.mastery_before * 100).toFixed(0)}% → ${(diagnosticResult.mastery_after * 100).toFixed(0)}%`
    : undefined;

  return (
    <>
    <QuestionSessionRunner
      key={attemptId}
      persistenceKey={attemptId}
      title={copy.title}
      subtitle={`${bundle?.kp_name || '当前知识点'} · ${copy.subtitle}`}
      printTitle={copy.printTitle}
      questions={session.questions}
      currentIndex={currentIdx}
      answeredCount={answeredCount}
      progressForQuestion={(questionId) => {
        const answer = answers[questionId];
        return { answered: !!answer, correct: answer?.is_correct };
      }}
      resultForQuestion={(questionId) => answers[questionId]}
      statusForQuestion={(questionId) => {
        const answer = answers[questionId];
        if (!answer) {
          if (isAssessment && collectedAnswers[questionId]) {
            return <span style={{ color: '#52c41a', fontWeight: 600 }}>已作答</span>;
          }
          return null;
        }
        return (
          <span style={{ color: answer.is_correct ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
            {answer.is_correct ? '已答对' : '需订正'}
          </span>
        );
      }}
      onBack={goBack}
      onGoToQuestion={goToQuestion}
      showPaperBatch={showPaperBatch}
      onTogglePaperBatch={togglePaperBatch}
      onBatchGraded={(results) => handleBatchGraded(results, isAssessment)}
      onAnswer={handleAnswer}
      onAnswered={handleAnsweredResult}
      collectMode
      deferredGrading
      onCollect={handleCollectAnswer}
      getTimeSpentMs={getQuestionTimeSpentMs}
      disabledCurrent={!!answers[session.questions[currentIdx].id]}
      error={diagnosticResultError}
      onAllGraded={() => {
        if (isAssessment) {
          void handleFinalizeDiagnostic();
        } else {
          setResultOpen(true);
        }
      }}
      lastAction={isAssessment ? (
        <button
          type="button"
          onClick={() => {
            if (diagnosticResult) {
              setResultOpen(true);
            } else {
              void handleFinalizeDiagnostic();
            }
          }}
          disabled={!allAnswered || (submittingDiagnostic && !diagnosticResult)}
          className={[
            'question-workspace-nav-button',
            'question-workspace-nav-button-primary',
            'question-workspace-header-submit',
            allAnswered && (!submittingDiagnostic || diagnosticResult) ? '' : 'is-disabled',
          ].filter(Boolean).join(' ')}
        >
          {diagnosticResult
            ? copy.result
            : diagnosticResultError
              ? '重新获取评估结果'
              : '正在生成评估结果...'}
        </button>
      ) : allAnswered ? (
        <button
          type="button"
          onClick={() => setResultOpen(true)}
          className="question-workspace-nav-button question-workspace-nav-button-primary question-workspace-header-submit"
        >
          {copy.result}
        </button>
      ) : (
        <span style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>
          答完后可查看练习结果
        </span>
      )}
      incompleteMessage={isAssessment && !allAnswered && currentIdx === total - 1 ? (
        <div style={{ textAlign: 'right', marginTop: 8, fontSize: 12, color: '#faad14' }}>
          还有题目未作答
        </div>
      ) : null}
    />
    <SessionResultDialog
      open={resultOpen && (isAssessment ? !!diagnosticResult : allAnswered)}
      onClose={() => setResultOpen(false)}
      title={copy.result}
      scoreText={isAssessment && diagnosticResult
        ? `${diagnosticResult.kp_name || bundle?.kp_name || '当前知识点'}：正确 ${diagnosticResult.correct_count}/${diagnosticResult.total_count}`
        : `${bundle?.kp_name || '当前知识点'}：得分 ${summary.correctCount}/${total}`}
      tone={isAssessment ? recommendation.tone : 'neutral'}
      label={isAssessment ? recommendation.label : summary.headline}
      feedback={isAssessment && diagnosticResult
        ? diagnosticResult.feedback
        : `得分率 ${(summary.accuracy * 100).toFixed(0)}%。${summary.nextStep.description}`}
      meta={isAssessment ? masteryMeta : undefined}
      actions={isAssessment ? (
        <>
          <Link to={`/learn/check?kp=${encodeURIComponent(kpId)}&count=5&mode=practice`} state={syncReturnState} className="train-primary-button practice-result-link">
            做巩固小练
          </Link>
          {diagnosticResult?.recommendation === 'study' && (
            <Link to={`/learn?kp=${encodeURIComponent(kpId)}`} state={syncReturnState} className="train-secondary-button practice-result-link">
              去同步学习
            </Link>
          )}
        </>
      ) : (
        <>
          <button type="button" onClick={restartPractice} className="train-primary-button practice-result-link">
            继续巩固
          </button>
          <Link to="/sync" state={{ restoreKpId: kpId }} className="train-secondary-button practice-result-link">
              回到同步学习
          </Link>
        </>
      )}
    />
    </>
  );
}
