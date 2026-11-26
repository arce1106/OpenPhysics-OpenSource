import TeacherPaperVideo from '../TeacherPaperVideo';
import QuestionTutorChat from '../QuestionTutorChat';
import { QuestionDisplaySurface, RichContent } from '../question-workspace';
import type { Question, ReviewMistake } from '../../types';
import ReviewProcessGradingSummary from './ReviewProcessGradingSummary';
import StudentAnswerDisplay from './StudentAnswerDisplay';

interface WrongQuestionCardProps {
  mistake: ReviewMistake;
  isRetrying: boolean;
  isCleared: boolean;
  onRetry: () => void;
  className?: string;
}

export default function WrongQuestionCard({
  mistake,
  isRetrying,
  isCleared,
  onRetry,
  className = '',
}: WrongQuestionCardProps) {
  return (
    <div className={['wrong-question-card', className].filter(Boolean).join(' ')}>
      <div className="review-mistake-section review-mistake-stem">
        <QuestionDisplaySurface
          question={mistakeToQuestion(mistake)}
          selected={mistake.given_answer || null}
          isDone
          readOnly
          disabled
        />
      </div>

      <TeacherPaperVideo lesson={mistake.lesson_video} questionId={mistake.question_id} answerId={mistake.answer_id} />
      <div className="review-mistake-answer-grid">
        <div className="review-mistake-section review-mistake-answer-wrong">
          <div className="review-mistake-section-title">你的答案</div>
          <div className="review-mistake-section-body">
            <StudentAnswerDisplay mistake={mistake} />
          </div>
        </div>
        <div className="review-mistake-section review-mistake-answer-correct">
          <div className="review-mistake-section-title">正确答案</div>
          <div className="review-mistake-section-body">
            <RichContent text={mistake.correct_answer || ''} rendered={mistake.correct_answer_rendered} />
          </div>
        </div>
      </div>

      {mistake.misconception && (
        <div className="review-mistake-section review-mistake-error-type">
          <span>错因类型：</span>
          {mistake.misconception.name}
        </div>
      )}
      {mistake.process_grading && (
        <div className="review-mistake-section review-mistake-process">
          <ReviewProcessGradingSummary grading={mistake.process_grading} />
        </div>
      )}
      <QuestionTutorChat
        questionId={mistake.question_id}
        givenAnswer={mistake.given_answer || ''}
        processGrading={mistake.process_grading}
        sideActions={(
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying || isCleared}
            className="question-tutor-side-action review-variant-floating-action"
            aria-label="做变式题"
          >
            <span className="review-variant-action-icon" aria-hidden="true" />
            <span className="question-tutor-trigger-text">
              {isRetrying ? '加载中' : '变式题'}
            </span>
          </button>
        )}
      />
      {mistake.explanation && (
        <div className="review-mistake-section review-mistake-explanation">
          <span className="review-mistake-section-title">解析</span>
          <RichContent text={mistake.explanation} rendered={mistake.explanation_rendered} />
        </div>
      )}

      {isCleared && (
        <div className="review-mistake-cleared">
          已清除：同类题答对后，这道错题不会再进入待复盘列表。
        </div>
      )}
    </div>
  );
}

function mistakeToQuestion(mistake: ReviewMistake): Question {
  return {
    id: mistake.question_id,
    stem_text: mistake.stem_text,
    question_type: mistake.question_type || undefined,
    options: mistake.options || [],
    images: mistake.images || [],
    correct_answer: mistake.correct_answer,
    explanation: mistake.explanation,
    given_answer: mistake.given_answer,
  };
}
