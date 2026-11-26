import { usePracticeSubmissionActivity } from './PracticeExitGuard';
import { useEffect, useState, useCallback, type ReactNode } from 'react';
import type { PhotoUploadDraft } from './PhotoUpload';
import { api } from '../api/client';
import { ChoiceAnswerPanel, GradingResultPanel, QuestionDraftWorkspace, QuestionStemPanel, WrittenAnswerPanel } from './question-workspace';
import type { HandwritingSnapshot } from './handwriting/HandwritingCanvas';
import type { Question, SubmitResult } from '../types';
import { getImageScaleStyle } from '../../../shared/questionImageDisplay';
import { attachHandwritingProcessEvidence } from '../utils/processEvidence';
import { resultCredit } from '../utils/resultCredit';
import type { SelfReviewDraft } from '../utils/selfReview';

function formatChoiceAnswer(labels: Iterable<string>) {
  return Array.from(labels).sort().join('');
}

function parseChoiceAnswer(answer: string | null | undefined) {
  return (answer || '')
    .replace(/[,，、\s]/g, '')
    .split('')
    .filter(Boolean);
}

function resultFeedbackStatus(result: SubmitResult) {
  const credit = resultCredit(result);
  if (result.is_correct || credit >= 0.999) {
    return {
      label: '✓ 回答正确！',
      background: '#f6ffed',
      border: '#b7eb8f',
      color: '#389e0d',
      aiFeedbackBackground: '#f6ffed',
      aiFeedbackBorder: '#b7eb8f',
      aiFeedbackColor: '#389e0d',
    };
  }
  if (credit > 0) {
    return {
      label: '△ 部分正确',
      background: '#fff7e6',
      border: '#ffd591',
      color: '#ad6800',
      aiFeedbackBackground: '#fffbe6',
      aiFeedbackBorder: '#ffe58f',
      aiFeedbackColor: '#ad6800',
    };
  }
  return {
    label: '✗ 需订正',
    background: '#fff2f0',
    border: '#ffccc7',
    color: '#cf1322',
    aiFeedbackBackground: '#fffbe6',
    aiFeedbackBorder: '#ffe58f',
    aiFeedbackColor: '#ad6800',
  };
}

interface QuestionCardProps {
  question: Question;
  onAnswer?: (questionId: string, answer: string) => Promise<SubmitResult>;
  disabled: boolean;
  externalResult?: SubmitResult;
  onAnswered?: (questionId: string, result: SubmitResult) => void;
  getTimeSpentMs?: () => number;
  collectMode?: boolean;
  onCollect?: (questionId: string, answer: string) => void;
  initialAnswer?: string;
  onDraftChange?: (questionId: string, answer: string) => void;
  photoDraft?: PhotoUploadDraft | null;
  handwritingDraft?: HandwritingSnapshot | null;
  selfReviewDraft?: SelfReviewDraft | null;
  draftBackgroundImageId?: string | null;
  onPhotoDraftChange?: (questionId: string, draft: PhotoUploadDraft | null) => void;
  onHandwritingDraftChange?: (questionId: string, draft: HandwritingSnapshot) => void;
  onSelfReviewDraftChange?: (questionId: string, draft: SelfReviewDraft | null) => void;
  onDraftBackgroundImageChange?: (questionId: string, imageId: string | null) => void;
  deferredGrading?: boolean;
  reviewMode?: boolean;
  resultActions?: ReactNode;
  tutorPlacement?: 'floating' | 'inline';
}

export default function QuestionCard({
  question,
  onAnswer,
  disabled,
  externalResult,
  onAnswered,
  getTimeSpentMs,
  collectMode,
  onCollect,
  initialAnswer,
  onDraftChange,
  photoDraft,
  handwritingDraft,
  selfReviewDraft,
  draftBackgroundImageId,
  onPhotoDraftChange,
  onHandwritingDraftChange,
  onSelfReviewDraftChange,
  onDraftBackgroundImageChange,
  deferredGrading,
  reviewMode = false,
  resultActions,
  tutorPlacement = 'floating',
}: QuestionCardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [collected, setCollected] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPhotoFallback, setShowPhotoFallback] = useState(false);
  const [correctionText, setCorrectionText] = useState('');
  const [correctionLoading, setCorrectionLoading] = useState(false);
  usePracticeSubmissionActivity(submitting || correctionLoading);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  const applyResult = useCallback((res: SubmitResult) => {
    setResult(res);
  }, []);

  const isNonChoiceQuestion = !question.options || question.options.length === 0;
  const isMultiChoice = question.question_type === 'multiple_choice';

  useEffect(() => {
    if (!externalResult) return;
    setResult(externalResult);
    const displayedAnswer = externalResult.extracted_answer || initialAnswer;
    if (displayedAnswer) {
      if (isMultiChoice) setMultiSelected(new Set(parseChoiceAnswer(displayedAnswer)));
      else setSelected(displayedAnswer);
    }
  }, [externalResult, initialAnswer, isMultiChoice]);

  const isAnsweredExternally = !!(collectMode && disabled && !!initialAnswer);
  const isDone = !!result || collected || isAnsweredExternally;
  const resultStatus = result ? resultFeedbackStatus(result) : null;
  const imageScaleStyles = question.images?.map(img => getImageScaleStyle(img));
  const currentAnswer = () => result?.extracted_answer || (isMultiChoice ? formatChoiceAnswer(multiSelected) : (selected || ''));
  const answerStatus = (
    <>
      {submitting && (
        <div className="question-card-status question-card-status-muted">
          提交中...
        </div>
      )}

      {submitError && (
        <div className="question-card-status question-card-status-error">
          {submitError}
        </div>
      )}

      {collected && !result && (
        <div className="question-card-status question-card-status-collected">
          ✓ 已作答
        </div>
      )}
    </>
  );

  useEffect(() => {
    if (!initialAnswer || externalResult) return;
    if (isMultiChoice) setMultiSelected(new Set(parseChoiceAnswer(initialAnswer)));
    else setSelected(initialAnswer);
  }, [externalResult, initialAnswer, isMultiChoice, question.id]);

  useEffect(() => {
    if (photoDraft) setShowPhotoFallback(true);
  }, [photoDraft]);

  const handlePhotoResult = (res: SubmitResult) => {
    applyResult(res);
    setSelected(res.extracted_answer || '[手写图片]');
    setSubmitError(null);
    onPhotoDraftChange?.(question.id, null);
    onAnswered?.(question.id, res);
    if (collectMode) {
      setCollected(true);
      onCollect?.(question.id, res.extracted_answer || '');
      return;
    }
  };

  const handleHandwritingResult = (res: SubmitResult) => {
    applyResult(res);
    setSelected(res.extracted_answer || '[手写图片]');
    setSubmitError(null);
    onAnswered?.(question.id, res);
    if (collectMode) {
      setCollected(true);
      onCollect?.(question.id, res.extracted_answer || '');
      return;
    }
  };

  const handleSelfReviewResult = (res: SubmitResult) => {
    applyResult(res);
    setSelected(res.extracted_answer || '[学生自评]');
    setSubmitError(null);
    onSelfReviewDraftChange?.(question.id, null);
    onAnswered?.(question.id, res);
    if (collectMode) {
      setCollected(true);
      onCollect?.(question.id, res.extracted_answer || '[学生自评]');
      return;
    }
  };

  const handleSelect = (label: string) => {
    if (disabled || submitting || isDone) return;
    if (isMultiChoice) {
      const next = new Set(multiSelected);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      setMultiSelected(next);
      onDraftChange?.(question.id, formatChoiceAnswer(next));
    } else {
      const next = selected === label ? null : label;
      setSelected(next);
      onDraftChange?.(question.id, next || '');
    }
  };

  const handleMcqSubmit = async () => {
    if (disabled || submitting || isDone) return;
    const answer = isMultiChoice
      ? formatChoiceAnswer(multiSelected)
      : selected;
    if (!answer) return;
    if (collectMode) {
      setCollected(true);
      onCollect?.(question.id, answer);
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const ownerToken = localStorage.getItem('openphysics.student_token');
    try {
      const submitted = await onAnswer!(question.id, answer);
      if (localStorage.getItem('openphysics.student_token') !== ownerToken) return;
      let res: SubmitResult = { ...submitted, extracted_answer: submitted.extracted_answer || answer };
      try {
        res = await attachHandwritingProcessEvidence(
          res,
          question.id,
          handwritingDraft,
          getTimeSpentMs?.() ?? 0,
        );
        res = { ...res, extracted_answer: res.extracted_answer || answer };
      } catch {
        res = { ...submitted, extracted_answer: submitted.extracted_answer || answer };
      }
      applyResult(res);
      onAnswered?.(question.id, res);
    } catch (e: any) {
      setSubmitError(e.message || '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualCorrection = async (isCorrect: boolean) => {
    if (!result?.answer_id || correctionLoading) return;
    const corrected = correctionText.trim() || result.extracted_answer || selected || '';
    setCorrectionLoading(true);
    setCorrectionError(null);
    try {
      const next = await api.correctAnswer(result.answer_id, {
        corrected_answer: corrected,
        is_correct: isCorrect,
        correction_reason: '学生手动纠正 AI 批改结果',
      });
      applyResult(next);
      setCorrectionText('');
      onAnswered?.(question.id, next);
      if (collectMode) onCollect?.(question.id, next.extracted_answer || corrected);
    } catch (e: any) {
      setCorrectionError(e.message || '纠错提交失败');
    } finally {
      setCorrectionLoading(false);
    }
  };

  const choiceAnswerPanel = !isNonChoiceQuestion ? (
    <ChoiceAnswerPanel
      question={question}
      selected={selected}
      multiSelected={multiSelected}
      isMultiChoice={isMultiChoice}
      isDone={isDone}
      disabled={disabled}
      submitting={submitting}
      collectMode={collectMode}
      deferredGrading={deferredGrading}
      result={result}
      imageScaleStyles={imageScaleStyles}
      onSelect={handleSelect}
      onSubmit={handleMcqSubmit}
    />
  ) : null;

  return (
    <div className={`card question-card-workspace${isNonChoiceQuestion ? '' : ' is-choice-question'}${reviewMode ? ' is-review-mode' : ''}`}>
      <div className="question-card-main">
        <div className="question-card-stem-region">
          <QuestionStemPanel question={question} />
          {!isNonChoiceQuestion && (
            <div className="question-card-choice-region">
              {choiceAnswerPanel}
              {answerStatus}
            </div>
          )}
        </div>

        {!reviewMode && <div className="question-card-answer-region">
          {isNonChoiceQuestion ? (
            <>
              <WrittenAnswerPanel
                question={question}
                disabled={disabled}
                submitting={submitting}
                isDone={isDone}
                showPhotoFallback={showPhotoFallback}
                deferredGrading={deferredGrading}
                photoDraft={photoDraft}
                handwritingDraft={handwritingDraft}
                selfReviewDraft={selfReviewDraft}
                draftBackgroundImageId={draftBackgroundImageId}
                getTimeSpentMs={getTimeSpentMs}
                onTogglePhotoFallback={() => setShowPhotoFallback(!showPhotoFallback)}
                onHandwritingResult={handleHandwritingResult}
                onPhotoResult={handlePhotoResult}
                onSelfReviewResult={handleSelfReviewResult}
                onPhotoDraftChange={(draft) => onPhotoDraftChange?.(question.id, draft)}
                onHandwritingDraftChange={(draft) => onHandwritingDraftChange?.(question.id, draft)}
                onSelfReviewDraftChange={(draft) => onSelfReviewDraftChange?.(question.id, draft)}
                onDraftBackgroundImageChange={(imageId) => onDraftBackgroundImageChange?.(question.id, imageId)}
              />
              {answerStatus}
            </>
          ) : (
            <QuestionDraftWorkspace
              question={question}
              disabled={disabled}
              submitting={submitting}
              isDone={isDone}
              submitEnabled={false}
              showPhotoUpload={false}
              handwritingDraft={handwritingDraft}
              draftBackgroundImageId={draftBackgroundImageId}
              onHandwritingDraftChange={(draft) => onHandwritingDraftChange?.(question.id, draft)}
              onDraftBackgroundImageChange={(imageId) => onDraftBackgroundImageChange?.(question.id, imageId)}
            />
          )}
        </div>}
      </div>

      {result && (
        <div className="question-card-feedback-region">
          <GradingResultPanel
            question={question}
            result={result}
            resultStatus={resultStatus!}
            imageScaleStyles={imageScaleStyles}
            correctionText={correctionText}
            correctionLoading={correctionLoading}
            correctionError={correctionError}
            givenAnswer={currentAnswer()}
            resultActions={resultActions}
            tutorPlacement={tutorPlacement}
            onCorrectionTextChange={setCorrectionText}
            onManualCorrection={handleManualCorrection}
          />
        </div>
      )}
    </div>
  );
}
