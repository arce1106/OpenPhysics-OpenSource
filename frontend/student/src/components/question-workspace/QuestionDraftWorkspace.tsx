import { useEffect, useMemo, useState, type ReactNode } from 'react';
import HandwritingPad from '../HandwritingPad';
import type { HandwritingSnapshot } from '../handwriting/HandwritingCanvas';
import PhotoUpload, { type PhotoUploadDraft } from '../PhotoUpload';
import type { Question, QuestionImage, SubmitResult } from '../../types';

interface QuestionDraftWorkspaceProps {
  question: Question;
  disabled: boolean;
  submitting: boolean;
  isDone: boolean;
  showPhotoFallback?: boolean;
  deferredGrading?: boolean;
  photoDraft?: PhotoUploadDraft | null;
  handwritingDraft?: HandwritingSnapshot | null;
  draftBackgroundImageId?: string | null;
  getTimeSpentMs?: () => number;
  submitEnabled?: boolean;
  showPhotoUpload?: boolean;
  footerLeadingActions?: ReactNode;
  onTogglePhotoFallback?: () => void;
  onHandwritingResult?: (result: SubmitResult) => void;
  onPhotoResult?: (result: SubmitResult) => void;
  onPhotoDraftChange?: (draft: PhotoUploadDraft | null) => void;
  onHandwritingDraftChange?: (draft: HandwritingSnapshot) => void;
  onDraftBackgroundImageChange?: (imageId: string | null) => void;
}

export default function QuestionDraftWorkspace({
  question,
  disabled,
  submitting,
  isDone,
  showPhotoFallback,
  deferredGrading,
  photoDraft,
  handwritingDraft,
  draftBackgroundImageId,
  getTimeSpentMs,
  submitEnabled = true,
  showPhotoUpload = true,
  footerLeadingActions,
  onTogglePhotoFallback,
  onHandwritingResult,
  onPhotoResult,
  onPhotoDraftChange,
  onHandwritingDraftChange,
  onDraftBackgroundImageChange,
}: QuestionDraftWorkspaceProps) {
  const answerDisabled = disabled || submitting || isDone;
  const effectiveSubmitEnabled = submitEnabled && !deferredGrading;
  const draftImages = useMemo(() => questionDraftImages(question), [question]);
  const [localBackgroundImageId, setLocalBackgroundImageId] = useState<string | null>(null);
  const isBackgroundImageControlled = draftBackgroundImageId !== undefined;
  const backgroundImageId = isBackgroundImageControlled ? draftBackgroundImageId : localBackgroundImageId;
  const selectedImage = draftImages.find(image => image.id === backgroundImageId) || null;

  const photoToggle = showPhotoUpload ? (
    <button
      type="button"
      className="written-answer-photo-toggle"
      onClick={onTogglePhotoFallback}
      disabled={answerDisabled}
      aria-expanded={!!showPhotoFallback}
    >
      <span aria-hidden="true">{showPhotoFallback ? '▾' : '▸'}</span>
      拍照上传纸面解答
    </button>
  ) : null;
  const footerActions = (
    <>
      {photoToggle}
    </>
  );

  const setBackgroundImageId = (imageId: string | null) => {
    if (isBackgroundImageControlled) onDraftBackgroundImageChange?.(imageId);
    else setLocalBackgroundImageId(imageId);
  };

  useEffect(() => {
    if (!backgroundImageId) return;
    if (draftImages.some(image => image.id === backgroundImageId)) return;
    setBackgroundImageId(null);
  }, [backgroundImageId, draftImages]);

  return (
    <div className="question-draft-workspace">
      {draftImages.length > 0 && (
        <div className="question-draft-background-tools">
          <span className="question-draft-background-label">题图背景</span>
          <div className="question-draft-background-actions">
            {draftImages.map((image, index) => (
              <button
                key={image.id}
                type="button"
                className={[
                  'question-draft-background-button',
                  image.id === backgroundImageId ? 'is-active' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setBackgroundImageId(image.id)}
                disabled={answerDisabled}
              >
                {draftImages.length === 1 ? '放入草稿纸' : `题图 ${index + 1}`}
              </button>
            ))}
            {backgroundImageId && (
              <button
                type="button"
                className="question-draft-background-button is-ghost"
                onClick={() => setBackgroundImageId(null)}
                disabled={answerDisabled}
              >
                清除背景
              </button>
            )}
          </div>
        </div>
      )}

      <HandwritingPad
        questionId={question.id}
        targetKnowledgePointId={question.target_knowledge_point_id}
        onResult={onHandwritingResult}
        initialSnapshot={handwritingDraft}
        onSnapshotChange={onHandwritingDraftChange}
        getTimeSpentMs={getTimeSpentMs}
        disabled={answerDisabled}
        compact
        submitEnabled={effectiveSubmitEnabled}
        canvasHeight={effectiveSubmitEnabled ? 500 : 470}
        footerLeadingActions={footerLeadingActions}
        footerActions={footerActions}
        backgroundImage={selectedImage ? {
          src: selectedImage.image_path,
          description: selectedImage.description || '题目附图',
          fit: 'contain',
        } : null}
      />

      {showPhotoUpload && showPhotoFallback && (
      <div className="written-answer-photo-section">
        <div className="written-answer-photo-upload">
          <PhotoUpload
            questionId={question.id}
            targetKnowledgePointId={question.target_knowledge_point_id}
            onResult={onPhotoResult!}
            getTimeSpentMs={getTimeSpentMs}
            disabled={answerDisabled}
            draft={photoDraft}
            onDraftChange={onPhotoDraftChange}
            deferUpload={deferredGrading}
          />
        </div>
      </div>
      )}
    </div>
  );
}

function questionDraftImages(question: Question): QuestionImage[] {
  return (question.images || []).filter(image => image.image_type !== 'explanation' && image.image_type !== 'option');
}
