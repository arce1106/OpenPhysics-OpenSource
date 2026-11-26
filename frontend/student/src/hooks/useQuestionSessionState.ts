import { useCallback, useEffect, useRef, useState } from 'react';
import type { SubmitResult } from '../types';
import { loadPracticeRecord, newPracticeRecord, savePracticeRecord, saveAttemptResult, discardPracticeAttempt, type PracticeRecord } from '../utils/practicePersistence';
import { attemptSubmissionId } from '../utils/submissionIdentity';
type SubmitAnswer = (questionId: string, answer: string, timeSpentMs: number, submissionId?: string) => Promise<SubmitResult>;
interface UseQuestionSessionStateOptions {
  submitAnswer: SubmitAnswer;
  persistenceScope?: string;
  studentId?: string;
}
export function useQuestionSessionState({ submitAnswer, persistenceScope, studentId = '' }: UseQuestionSessionStateOptions) {
  const recordRef = useRef<PracticeRecord | null>(null);
  const activeRef = useRef(true);
  if (!recordRef.current)
    recordRef.current = (persistenceScope && loadPracticeRecord(studentId, persistenceScope))
      || newPracticeRecord(studentId, persistenceScope || 'ephemeral');
  const [attemptId, setAttemptId] = useState(recordRef.current.id);
  const [answers, setAnswers] = useState<Record<string, SubmitResult>>(recordRef.current.answers);
  const [collectedAnswers, setCollectedAnswers] = useState<Record<string, string>>(recordRef.current.collectedAnswers);
  const [currentIdx, setCurrentIdx] = useState(recordRef.current.currentIdx);
  const [showPaperBatch, setShowPaperBatch] = useState(false);
  const questionStartTime = useRef<number>(Date.now());
  const save = useCallback((change: Partial<PracticeRecord>) => {
    recordRef.current = { ...recordRef.current!, ...change };
    if (persistenceScope)
      savePracticeRecord(recordRef.current);
  }, [persistenceScope]);
  const persistSessionPayload = useCallback((payload: Record<string, unknown>) => save({ payload }), [save]);
  const resetSessionState = useCallback((options?: {
    preserveSaved?: boolean;
  }) => {
    if (persistenceScope && !options?.preserveSaved && recordRef.current) {
      void discardPracticeAttempt(`${studentId}:${recordRef.current.id}`);
    }
    const record = newPracticeRecord(studentId, persistenceScope || 'ephemeral');
    recordRef.current = record;
    setAttemptId(record.id);
    if (persistenceScope && !options?.preserveSaved)
      savePracticeRecord(record);
    setCurrentIdx(0);
    setAnswers({});
    setCollectedAnswers({});
    setShowPaperBatch(false);
    questionStartTime.current = Date.now();
  }, [persistenceScope, studentId]);
  const restoreSessionState = useCallback((results: Record<string, SubmitResult>, preserveDrafts = false) => {
    const record = preserveDrafts ? recordRef.current! : newPracticeRecord(studentId, persistenceScope || 'ephemeral');
    recordRef.current = { ...record, answers: results, currentIdx: 0 };
    setAttemptId(record.id);
    setAnswers(results);
    setCurrentIdx(0);
    setCollectedAnswers(preserveDrafts ? record.collectedAnswers : {});
    setShowPaperBatch(false);
    if (persistenceScope) {
      savePracticeRecord(recordRef.current);
      Object.entries(results).forEach(([id, result]) => saveAttemptResult(`${studentId}:${record.id}`, id, result));
    }
  }, [persistenceScope, studentId]);
  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);
  const getQuestionTimeSpentMs = useCallback(() => (Date.now() - questionStartTime.current), []);
  const goToQuestion = useCallback((idx: number) => {
    save({ currentIdx: idx });
    setCurrentIdx(idx);
    questionStartTime.current = Date.now();
  }, [save]);
  const togglePaperBatch = useCallback(() => {
    setShowPaperBatch(prev => !prev);
  }, []);
  const handleAnswer = useCallback(async (questionId: string, answer: string): Promise<SubmitResult> => {
    const current = recordRef.current!;
    if (current.answers[questionId])
      return current.answers[questionId];
    const result = persistenceScope
      ? await submitAnswer(questionId, answer, getQuestionTimeSpentMs(), attemptSubmissionId(`${studentId}:${current.id}:${questionId}:${answer}`))
      : await submitAnswer(questionId, answer, getQuestionTimeSpentMs());
    if (persistenceScope)
      saveAttemptResult(`${studentId}:${current.id}`, questionId, result);
    if (!activeRef.current || recordRef.current?.id !== current.id)
      return result;
    const next = { ...recordRef.current.answers, [questionId]: result };
    save({ answers: next });
    setAnswers(next);
    return result;
  }, [getQuestionTimeSpentMs, submitAnswer, persistenceScope, studentId, save]);
  const handleAnsweredResult = useCallback((questionId: string, result: SubmitResult) => {
    if (persistenceScope)
      saveAttemptResult(`${studentId}:${attemptId}`, questionId, result);
    if (!activeRef.current || recordRef.current?.id !== attemptId)
      return;
    const next = { ...recordRef.current.answers, [questionId]: result };
    save({ answers: next });
    setAnswers(next);
  }, [save, attemptId, persistenceScope, studentId]);
  const handleBatchGraded = useCallback((results: Record<string, SubmitResult>, collectExtractedAnswers = false) => {
    if (persistenceScope)
      Object.entries(results).forEach(([id, result]) => saveAttemptResult(`${studentId}:${attemptId}`, id, result));
    if (!activeRef.current || recordRef.current?.id !== attemptId)
      return;
    if (collectExtractedAnswers) {
      const next = { ...recordRef.current!.collectedAnswers };
      Object.entries(results).forEach(([questionId, result]) => {
        if (result.extracted_answer)
          next[questionId] = result.extracted_answer;
      });
      save({ collectedAnswers: next });
      setCollectedAnswers(next);
    }
    const next = { ...recordRef.current!.answers, ...results };
    save({ answers: next });
    setAnswers(next);
  }, [save, persistenceScope, studentId, attemptId]);
  const handleCollectAnswer = useCallback((questionId: string, answer: string) => {
    if (!activeRef.current || recordRef.current?.id !== attemptId)
      return;
    const next = { ...recordRef.current!.collectedAnswers, [questionId]: answer };
    save({ collectedAnswers: next });
    setCollectedAnswers(next);
  }, [save, attemptId]);
  return {
    attemptId: persistenceScope ? `${studentId}:${attemptId}` : undefined,
    persistSessionPayload,
    answers,
    collectedAnswers,
    currentIdx,
    showPaperBatch,
    resetSessionState,
    restoreSessionState,
    goToQuestion,
    togglePaperBatch,
    handleAnswer,
    handleAnsweredResult,
    handleBatchGraded,
    handleCollectAnswer,
    getQuestionTimeSpentMs,
  };
}
