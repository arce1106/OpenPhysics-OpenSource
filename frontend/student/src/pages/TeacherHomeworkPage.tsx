import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { getStudentId } from '../api/studentIdentity';
import QuestionSessionRunner from '../components/QuestionSessionRunner';
import TeacherPaperReview from '../components/TeacherPaperReview';
import { useQuestionSessionState } from '../hooks/useQuestionSessionState';
import { getReturnState } from '../utils/navigation';
import { homeworkScore } from '../utils/teacherHomework';
import type { PracticeSession } from '../types';

/**
 * A teacher's personalized homework, answered like a fixed paper: answer every question,
 * submit, then each answer is graded; the teacher reviews the results afterwards.
 */
export default function TeacherHomeworkPage() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  // Opened from 作业记录, back returns there; otherwise home.
  const backTo = getReturnState(useLocation()).from === '/homework' ? '/homework' : '/';
  const backLabel = backTo === '/homework' ? '返回作业记录' : '返回首页';
  const studentId = getStudentId();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const completedChecked = useRef<string | null>(null);

  const submitAnswer = useCallback(
    (questionId: string, answer: string, timeSpentMs: number, submissionId?: string) => (
      api.submitAnswer(studentId, {
        question_id: questionId,
        given_answer: answer,
        time_spent_ms: timeSpentMs,
        teacher_paper_attempt_id: attemptId,
        ...(submissionId && { submission_id: submissionId }),
      })
    ),
    [attemptId, studentId],
  );
  const {
    answers, collectedAnswers, currentIdx, showPaperBatch, restoreSessionState, goToQuestion, togglePaperBatch,
    handleAnswer, handleAnsweredResult, handleBatchGraded, handleCollectAnswer, getQuestionTimeSpentMs,
    attemptId: localAttempt, persistSessionPayload,
  } = useQuestionSessionState({ submitAnswer, studentId, persistenceScope: `homework:${attemptId}` });

  const load = useCallback(async () => {
    const next = await api.openTeacherHomework(attemptId);
    restoreSessionState(next.answers || {}, true);
    setSession(next);
    setError(null);
  }, [attemptId, restoreSessionState]);

  useEffect(() => {
    load().catch((cause) => setError(cause instanceof Error ? cause.message : '作业加载失败'));
  }, [load]);

  useEffect(() => {
    if (session) persistSessionPayload({ session });
  }, [session, persistSessionPayload, localAttempt]);

  const paper = session?.teacher_paper;
  const allGraded = !!session && session.questions.length > 0 && session.questions.every((q) => !!answers[q.id]);
  // The last grade completes the attempt on the server; fetch its final state once.
  useEffect(() => {
    if (!allGraded || !paper?.attempt_id || paper.status === 'completed' || completedChecked.current === paper.attempt_id) return;
    completedChecked.current = paper.attempt_id;
    load().catch((cause) => setError(cause instanceof Error ? cause.message : '作业状态更新失败，请重试'));
  }, [allGraded, paper, load]);

  const beginGrading = useCallback(async () => {
    await api.submitTeacherPaperAttempt(attemptId);
    setSession((current) => current && current.teacher_paper
      ? { ...current, teacher_paper: { ...current.teacher_paper, status: 'grading' } } : current);
  }, [attemptId]);

  if (error && !session) {
    return (
      <main className="container train-workspace train-empty-state">
        <div className="error-banner">{error}</div>
        <button type="button" className="train-route-secondary-button" onClick={() => navigate(backTo)}>{backLabel}</button>
      </main>
    );
  }
  if (!session || !paper) return <div className="loading">正在准备老师作业...</div>;

  if (allGraded && paper.status === 'completed') {
    return (
      <TeacherPaperReview key={paper.attempt_id} title={paper.title} heading={`老师作业 · ${paper.title}`}
        questions={session.questions} answers={answers} videoEnabled={false} error={error}
        score={homeworkScore(paper)}
        onAnswered={handleAnsweredResult} onBack={() => navigate(backTo)} backLabel={backLabel} />
    );
  }

  const answeredCount = new Set([...Object.keys(answers), ...Object.keys(collectedAnswers)]).size;
  return (
    <>
      {paper.status === 'grading' && (
        <div className="container teacher-paper-grading-status" role="status">
          已提交 · 已批改 {Object.keys(answers).length}/{session.questions.length} 题。未完成部分可继续批改。
        </div>
      )}
      <QuestionSessionRunner
        key={localAttempt}
        persistenceKey={localAttempt}
        title="老师作业"
        subtitle={session.session_objective}
        printTitle={`老师作业 · ${paper.title}`}
        teacherPaperAttemptId={attemptId}
        onBeforeDeferredGrading={beginGrading}
        questions={session.questions}
        currentIndex={currentIdx}
        answeredCount={answeredCount}
        progressForQuestion={(questionId) => ({
          answered: !!answers[questionId] || !!collectedAnswers[questionId],
          correct: answers[questionId]?.is_correct,
        })}
        resultForQuestion={(questionId) => answers[questionId]}
        submitted={['grading', 'completed'].includes(paper.status || '')}
        onBack={() => navigate(backTo)}
        onGoToQuestion={goToQuestion}
        showPaperBatch={showPaperBatch}
        onTogglePaperBatch={togglePaperBatch}
        onBatchGraded={(results) => handleBatchGraded(results, true)}
        onAnswer={handleAnswer}
        onAnswered={handleAnsweredResult}
        collectMode
        deferredGrading
        wholePaper
        readOnly={allGraded}
        onCollect={handleCollectAnswer}
        getTimeSpentMs={getQuestionTimeSpentMs}
        disabledCurrent={paper.status === 'grading' || !!answers[session.questions[currentIdx]?.id]}
        error={error}
        lastAction={<span className="gaokao-session-hint">全部作答后统一提交批改</span>}
      />
    </>
  );
}
