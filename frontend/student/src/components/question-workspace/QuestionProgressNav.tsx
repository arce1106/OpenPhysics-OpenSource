import type { Question } from '../../types';

interface QuestionProgressState {
  answered: boolean;
  correct?: boolean;
}

interface QuestionProgressNavProps {
  questions: Question[];
  currentIndex: number;
  progressForQuestion: (questionId: string) => QuestionProgressState;
  onGoToQuestion: (index: number) => void;
  shouldUseDeferredGrading?: boolean;
  isQuestionReadyForDeferredGrading?: (question: Question) => boolean;
}

export default function QuestionProgressNav({
  questions,
  currentIndex,
  progressForQuestion,
  onGoToQuestion,
  shouldUseDeferredGrading = false,
  isQuestionReadyForDeferredGrading,
}: QuestionProgressNavProps) {
  return (
    <div className="question-workspace-progress">
      {questions.map((item, index) => {
        const parentProgress = progressForQuestion(item.id);
        const progress = shouldUseDeferredGrading && isQuestionReadyForDeferredGrading?.(item)
          ? { ...parentProgress, answered: true }
          : parentProgress;
        const className = [
          'question-workspace-progress-button',
          progress.answered ? 'is-answered' : '',
          progress.correct === false ? 'is-wrong' : '',
          index === currentIndex ? 'is-current' : '',
        ].filter(Boolean).join(' ');

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onGoToQuestion(index)}
            className={className}
          >
            {index + 1}
          </button>
        );
      })}
    </div>
  );
}
