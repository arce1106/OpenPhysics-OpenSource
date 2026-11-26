import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {PracticeAttemptContext,TeacherPaperAttemptContext,TopicSubmissionContext,optionalPaperSubmissionScope} from './PracticeAttemptContext';
import { api } from '../api/client';
import { getStudentId } from '../api/studentIdentity';
import type { SubmitResult } from '../types';
import {
  HANDWRITING_BACKGROUND_IMAGE_ERROR,
  handwritingSnapshotToFile,
} from '../utils/handwritingExport';
import HandwritingCanvas, {
  type HandwritingCanvasBackgroundImage,
  type HandwritingCanvasHandle,
  type HandwritingSnapshot,
} from './handwriting/HandwritingCanvas';

interface Props {
  questionId: string;
  targetKnowledgePointId?: string | null;
  onResult?: (result: SubmitResult) => void;
  disabled?: boolean;
  getTimeSpentMs?: () => number;
  title?: string;
  hint?: string;
  backgroundImage?: HandwritingCanvasBackgroundImage | null;
  initialSnapshot?: HandwritingSnapshot | null;
  onSnapshotChange?: (snapshot: HandwritingSnapshot) => void;
  submitEnabled?: boolean;
  compact?: boolean;
  canvasHeight?: number;
  footerLeadingActions?: ReactNode;
  footerActions?: ReactNode;
}

const CANVAS_BG = '#fffdf8';
const CANVAS_HEIGHT = 360;

export default function HandwritingPad({
  questionId,
  targetKnowledgePointId,
  onResult,
  disabled,
  getTimeSpentMs,
  title = '手写答题区',
  hint = '支持触控笔、手指书写；提交后由 AI 识别并批改',
  backgroundImage,
  initialSnapshot,
  onSnapshotChange,
  submitEnabled = true,
  compact = false,
  canvasHeight = CANVAS_HEIGHT,
  footerLeadingActions,
  footerActions,
}: Props) {
  const attemptScope=useContext(PracticeAttemptContext);
  const teacherPaperAttempt = useContext(TeacherPaperAttemptContext);
  const topicContext = useContext(TopicSubmissionContext);
  const initialStrokeCount = initialSnapshot?.strokes?.length || 0;
  const hasInitialDraft = initialStrokeCount > 0 || !!initialSnapshot?.backgroundImage;
  const handwritingRef = useRef<HandwritingCanvasHandle | null>(null);
  const [strokeCount, setStrokeCount] = useState(() => initialStrokeCount);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSnapshotChangeRef = useRef(onSnapshotChange);
  const hasSavedDraftRef = useRef(hasInitialDraft);

  onSnapshotChangeRef.current = onSnapshotChange;

  useEffect(() => {
    setStrokeCount(initialStrokeCount);
    hasSavedDraftRef.current = hasInitialDraft;
    setError(null);
  }, [hasInitialDraft, initialStrokeCount, questionId]);

  const persistCurrentSnapshot = useCallback((allowEmpty = false) => {
    const snapshot = handwritingRef.current?.getSnapshot();
    if (!snapshot) return;
    const hasDraftContent = snapshot.strokes.length > 0 || !!snapshot.backgroundImage;
    if (!allowEmpty && !hasDraftContent) return;
    onSnapshotChangeRef.current?.(snapshot);
    if (hasDraftContent) hasSavedDraftRef.current = true;
  }, []);

  const handleStrokeCountChange = useCallback((count: number) => {
    setStrokeCount(count);
    if (count > 0) setError(null);
    if (count === 0 && !hasSavedDraftRef.current) return;
    persistCurrentSnapshot(true);
  }, [persistCurrentSnapshot]);

  const handleSubmit = async () => {
    if (!submitEnabled || disabled || submitting) return;
    const handwriting = handwritingRef.current;
    if (!handwriting?.hasStrokes()) {
      setError('请先在答题区手写解答过程');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const snapshot = handwriting.getSnapshot();
      const ownerToken = localStorage.getItem('openphysics.student_token');
      if (backgroundImage?.src && snapshot.backgroundImage?.imagePath !== backgroundImage.src) {
        throw new Error(HANDWRITING_BACKGROUND_IMAGE_ERROR);
      }
      const file = await handwritingSnapshotToFile(snapshot, `handwriting-${questionId}.png`);
      if (localStorage.getItem('openphysics.student_token') !== ownerToken) return;
      const timeSpentMs = getTimeSpentMs?.() ?? 0;
      await teacherPaperAttempt?.beforeSubmit?.();
      const result = await api.submitPhoto(
        getStudentId(),
        file,
        questionId,
        timeSpentMs,
        targetKnowledgePointId,
        ...optionalPaperSubmissionScope(attemptScope, teacherPaperAttempt?.id, topicContext),
      );
      onResult?.(result);
    } catch (e: any) {
      setError(e.message || '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`handwriting-pad${compact ? ' is-compact' : ''}`}>
      {!compact && (
      <div className="handwriting-pad__header">
        <div>
          <div className="handwriting-pad__title">{title}</div>
          <div className="handwriting-pad__hint">{hint}</div>
        </div>
      </div>
      )}

      <HandwritingCanvas
        key={questionId}
        ref={handwritingRef}
        ariaLabel="手写答题区"
        disabled={disabled}
        submitting={submitting}
        height={canvasHeight}
        background={CANVAS_BG}
        eraserMode="background"
        backgroundImage={backgroundImage}
        initialSnapshot={initialSnapshot}
        toolbarPlacement="floating-right"
        enablePanTool
        workspaceScale={1.42}
        onStrokeCountChange={handleStrokeCountChange}
        onSnapshotChange={() => persistCurrentSnapshot(true)}
        canvasStyle={{
          borderRadius: 0,
          border: 'none',
          background: CANVAS_BG,
        }}
      />

      {(submitEnabled || footerActions || footerLeadingActions) && (
      <div className="handwriting-pad__footer">
        {footerLeadingActions && (
          <div className="handwriting-pad__footer-leading">
            {footerLeadingActions}
          </div>
        )}
        <div className="handwriting-pad__footer-trailing">
          {submitEnabled && (
            <button
              type="button"
              className="handwriting-pad__submit"
              onClick={handleSubmit}
              disabled={disabled || submitting || strokeCount === 0}
            >
              {submitting ? 'AI 批改中...' : '提交手写答案'}
            </button>
          )}
          {footerActions}
        </div>
      </div>
      )}
      {error && <div className="handwriting-pad__error">{error}</div>}
    </div>
  );
}
