import type { ReactNode } from 'react';
import QuestionDraftWorkspace from './QuestionDraftWorkspace';
import SelfReviewPanel from './SelfReviewPanel';
import type { HandwritingSnapshot } from '../handwriting/HandwritingCanvas';
import type { PhotoUploadDraft } from '../PhotoUpload';
import type { Question, SubmitResult } from '../../types';
import { canSelfReviewQuestion, type SelfReviewDraft } from '../../utils/selfReview';

interface WrittenAnswerPanelProps {
  question: Question;
  disabled: boolean;
  submitting: boolean;
  isDone: boolean;
  showPhotoFallback: boolean;
  deferredGrading?: boolean;
  photoDraft?: PhotoUploadDraft | null;
  handwritingDraft?: HandwritingSnapshot | null;
  selfReviewDraft?: SelfReviewDraft | null;
  draftBackgroundImageId?: string | null;
  getTimeSpentMs?: () => number;
  onTogglePhotoFallback: () => void;
  onHandwritingResult: (result: SubmitResult) => void;
  onPhotoResult: (result: SubmitResult) => void;
  onPhotoDraftChange?: (draft: PhotoUploadDraft | null) => void;
  onHandwritingDraftChange?: (draft: HandwritingSnapshot) => void;
  onSelfReviewDraftChange?: (draft: SelfReviewDraft | null) => void;
  onSelfReviewResult?: (result: SubmitResult) => void;
  onDraftBackgroundImageChange?: (imageId: string | null) => void;
}

export default function WrittenAnswerPanel({
  question,
  disabled,
  submitting,
  isDone,
  showPhotoFallback,
  deferredGrading,
  photoDraft,
  handwritingDraft,
  selfReviewDraft,
  draftBackgroundImageId,
  getTimeSpentMs,
  onTogglePhotoFallback,
  onHandwritingResult,
  onPhotoResult,
  onPhotoDraftChange,
  onHandwritingDraftChange,
  onSelfReviewDraftChange,
  onSelfReviewResult,
  onDraftBackgroundImageChange,
}: WrittenAnswerPanelProps) {
  const renderDraftWorkspace = (footerLeadingActions?: ReactNode) => (
    <QuestionDraftWorkspace
      question={question}
      disabled={disabled}
      submitting={submitting}
      isDone={isDone}
      showPhotoFallback={showPhotoFallback}
      deferredGrading={deferredGrading}
      photoDraft={photoDraft}
      handwritingDraft={handwritingDraft}
      draftBackgroundImageId={draftBackgroundImageId}
      getTimeSpentMs={getTimeSpentMs}
      footerLeadingActions={footerLeadingActions}
      onTogglePhotoFallback={onTogglePhotoFallback}
      onHandwritingResult={onHandwritingResult}
      onPhotoResult={onPhotoResult}
      onPhotoDraftChange={onPhotoDraftChange}
      onHandwritingDraftChange={onHandwritingDraftChange}
      onDraftBackgroundImageChange={onDraftBackgroundImageChange}
    />
  );
  const shouldShowSelfReview = !isDone && canSelfReviewQuestion(question);

  return (
    <div className="written-answer-panel">
      {shouldShowSelfReview ? (
        <SelfReviewPanel
          question={question}
          disabled={disabled || submitting}
          deferredGrading={deferredGrading}
          draft={selfReviewDraft}
          getTimeSpentMs={getTimeSpentMs}
          onDraftChange={onSelfReviewDraftChange}
          onResult={onSelfReviewResult}
          renderLayout={({ trigger, body }) => (
            <>
              {renderDraftWorkspace(trigger)}
              {body && (
                <div className="question-self-review-inline-body">
                  {body}
                </div>
              )}
            </>
          )}
        />
      ) : (
        renderDraftWorkspace()
      )}
    </div>
  );
}
