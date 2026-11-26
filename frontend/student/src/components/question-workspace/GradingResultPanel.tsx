import { useState, type ReactNode } from 'react';
import ZoomableImage from '../ZoomableImage';
import GradingTrustPanel from '../GradingTrustPanel';
import { GrowthFeedbackPanel } from '../RewardComponents';
import QuestionTutorChat from '../QuestionTutorChat';
import ProcessGradingSummary from './ProcessGradingSummary';
import RichContent from './RichContent';
import type { ProcessGrading, Question, SubmitResult } from '../../types';
import { getImageScaleStyle } from '../../../../shared/questionImageDisplay';

interface ResultStatusStyle {
  label: string;
  background: string;
  border: string;
  color: string;
  aiFeedbackBackground: string;
  aiFeedbackBorder: string;
  aiFeedbackColor: string;
}

interface GradingResultPanelProps {
  question: Question;
  result: SubmitResult;
  resultStatus: ResultStatusStyle;
  imageScaleStyles?: Array<Record<string, string> | undefined>;
  correctionText: string;
  correctionLoading: boolean;
  correctionError: string | null;
  givenAnswer: string;
  resultActions?: ReactNode;
  tutorPlacement?: 'floating' | 'inline';
  onCorrectionTextChange: (value: string) => void;
  onManualCorrection: (isCorrect: boolean) => void;
}

function answerImagePaths(grading?: ProcessGrading | null): string[] {
  const paths = [
    ...(grading?.answer_image_paths || []),
    ...(grading?.answer_image_path ? [grading.answer_image_path] : []),
  ];
  return Array.from(new Set(paths.filter(Boolean)));
}

function AnswerImagePreview({ grading }: { grading?: ProcessGrading | null }) {
  const paths = answerImagePaths(grading);
  if (paths.length === 0) return null;

  return (
    <div className="grading-result-answer-images">
      <div className="grading-result-section-label">学生作答图片</div>
      <div className="grading-result-answer-image-grid">
        {paths.map((path, index) => (
          <ZoomableImage
            key={path}
            src={path}
            alt={paths.length > 1 ? `学生作答图片 ${index + 1}` : '学生作答图片'}
            className="grading-result-answer-image"
          />
        ))}
      </div>
    </div>
  );
}

export default function GradingResultPanel({
  question,
  result,
  resultStatus,
  imageScaleStyles,
  correctionText,
  correctionLoading,
  correctionError,
  givenAnswer,
  resultActions,
  tutorPlacement = 'floating',
  onCorrectionTextChange,
  onManualCorrection,
}: GradingResultPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const explanationText = result.explanation?.trim() || '暂无解析，可生成解析';
  const hasDetailedFeedback = !!result.process_grading
    || !!(result.answer_id && result.process_grading)
    || !result.is_correct;

  return (
    <div
      className="grading-result-panel"
      style={{
        background: resultStatus.background,
        borderColor: resultStatus.border,
      }}
    >
      <div className="grading-result-title" style={{ color: resultStatus.color }}>
        {resultStatus.label}
      </div>

      {result.extracted_answer && (
        <div className="grading-result-extracted">
          AI 识别答案：<span><RichContent text={result.extracted_answer} rendered={result.extracted_answer_rendered} /></span>
        </div>
      )}

      <AnswerImagePreview grading={result.process_grading} />

      {result.ai_feedback && (
        <div
          className="grading-result-ai-feedback"
          style={{
            background: resultStatus.aiFeedbackBackground,
            borderColor: resultStatus.aiFeedbackBorder,
            color: resultStatus.aiFeedbackColor,
          }}
        >
          <RichContent text={result.ai_feedback} rendered={result.ai_feedback_rendered} />
        </div>
      )}

      {!result.is_correct && result.detected_misconception && (
        <div className="grading-result-misconception">
          检测到知识点混淆：<span>{result.detected_misconception.name}</span>
        </div>
      )}

      {!result.is_correct && (
        <div className="grading-result-correct-answer">
          <span className="grading-result-section-label">正确答案</span>
          <span><RichContent text={result.correct_answer} rendered={result.correct_answer_rendered} /></span>
        </div>
      )}

      <div className="grading-result-explanation">
        <span className="grading-result-section-label">解析</span>
        <RichContent
          text={explanationText}
          rendered={result.explanation_rendered}
          imagePaths={question.images?.map(img => img.image_path)}
          imageScaleStyles={imageScaleStyles}
        />
      </div>

      {question.images && question.images.filter(im => im.image_type === 'explanation').length > 0 && (
        <div className="grading-result-explanation-images">
          {question.images.filter(im => im.image_type === 'explanation').map(img => (
            <ZoomableImage
              key={img.id}
              src={img.image_path}
              alt={img.description || '解析附图'}
              className="question-image question-image-explanation"
              style={getImageScaleStyle(img)}
            />
          ))}
        </div>
      )}

      {!result.is_correct && tutorPlacement === 'floating' && (
        <QuestionTutorChat
          questionId={question.id}
          givenAnswer={givenAnswer}
          processGrading={result.process_grading}
        />
      )}

      {(hasDetailedFeedback || resultActions) && (
        <div className="grading-result-detail-toggle">
          {hasDetailedFeedback && <button
            type="button"
            className="grading-result-action-button"
            onClick={() => setDetailsOpen(open => !open)}
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? '收起详细批改' : '查看详细批改'}
          </button>}
          {resultActions}
          {!result.is_correct && tutorPlacement === 'inline' && (
            <QuestionTutorChat questionId={question.id} givenAnswer={givenAnswer}
              processGrading={result.process_grading} inlineTrigger />
          )}
        </div>
      )}

      {detailsOpen && (
        <div className="grading-result-detail-panel">
          {result.process_grading && (
            <>
              <GradingTrustPanel grading={result.process_grading} />
              <ProcessGradingSummary grading={result.process_grading} />
            </>
          )}

          <GrowthFeedbackPanel result={result} />

          {result.answer_id && result.process_grading && (
            <div className="grading-result-correction">
              <div className="grading-result-correction-note">
                AI 判断不准时，可以手动纠正，本题记录和掌握度会同步修正。
              </div>
              <div className="grading-result-correction-form">
                <input
                  type="text"
                  value={correctionText}
                  onChange={(event) => onCorrectionTextChange(event.target.value)}
                  placeholder="可填写正确识别的答案"
                  className="grading-result-correction-input"
                />
                <button
                  type="button"
                  onClick={() => onManualCorrection(true)}
                  disabled={correctionLoading}
                  className="grading-result-action-button"
                >
                  改为正确
                </button>
                <button
                  type="button"
                  onClick={() => onManualCorrection(false)}
                  disabled={correctionLoading}
                  className="grading-result-action-button"
                >
                  改为错误
                </button>
              </div>
              {correctionError && (
                <div className="grading-result-correction-error">{correctionError}</div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
