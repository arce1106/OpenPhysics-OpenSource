import LatexSpan from '../LatexSpan';
import type { Question, SubmitResult } from '../../types';

type ImageScaleStyle = Record<string, string> | undefined;

interface ChoiceAnswerPanelProps {
  question: Question;
  selected: string | null;
  multiSelected: Set<string>;
  isMultiChoice: boolean;
  isDone: boolean;
  disabled: boolean;
  submitting: boolean;
  collectMode?: boolean;
  deferredGrading?: boolean;
  result?: SubmitResult | null;
  imageScaleStyles?: ImageScaleStyle[];
  onSelect: (label: string) => void;
  onSubmit: () => void;
}

function parseChoiceAnswer(answer: string | null | undefined) {
  return (answer || '')
    .replace(/[,，、\s]/g, '')
    .split('')
    .filter(Boolean);
}

export default function ChoiceAnswerPanel({
  question,
  selected,
  multiSelected,
  isMultiChoice,
  isDone,
  disabled,
  submitting,
  collectMode,
  deferredGrading,
  result,
  imageScaleStyles,
  onSelect,
  onSubmit,
}: ChoiceAnswerPanelProps) {
  const imagePaths = question.images?.map(img => img.image_path);
  const hasAnswer = isMultiChoice ? multiSelected.size > 0 : !!selected;
  const shouldShowSubmit = hasAnswer && !isDone && !deferredGrading;
  const correctAnswers = result ? parseChoiceAnswer(result.correct_answer) : [];
  const givenAnswers = result
    ? (isMultiChoice ? Array.from(multiSelected) : selected ? [selected] : [])
    : [];

  const optionClassName = (label: string) => {
    const classes = ['choice-answer-option'];
    if (disabled || isDone) classes.push('is-disabled');

    if (!result) {
      const isSelected = isMultiChoice ? multiSelected.has(label) : selected === label;
      if (isSelected) classes.push('is-selected');
      return classes.join(' ');
    }

    const isCorrectAnswer = correctAnswers.includes(label);
    const isGivenAnswer = givenAnswers.includes(label);
    if (isCorrectAnswer) classes.push('is-correct');
    if (isGivenAnswer && !isCorrectAnswer) classes.push('is-wrong');
    if (isGivenAnswer && isCorrectAnswer) classes.push('is-given-correct');
    if (!isCorrectAnswer && !isGivenAnswer) classes.push('is-dimmed');
    return classes.join(' ');
  };

  const optionBadges = (label: string) => {
    if (!result) return null;
    const isCorrectAnswer = correctAnswers.includes(label);
    const isGivenAnswer = givenAnswers.includes(label);
    if (!isCorrectAnswer && !isGivenAnswer) return null;
    return (
      <span className="choice-answer-badges">
        {isGivenAnswer && (
          <span className={`choice-answer-badge${isCorrectAnswer ? ' is-yours-correct' : ' is-yours-wrong'}`}>
            我的选择
          </span>
        )}
        {isCorrectAnswer && (
          <span className="choice-answer-badge is-correct-answer">
            正确答案
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="choice-answer-panel">
      {question.options.map(opt => (
        <div
          key={opt.label}
          className={optionClassName(opt.label)}
          onClick={() => onSelect(opt.label)}
        >
          <span className={`choice-answer-label${isMultiChoice ? ' is-multiple' : ''}`}>
            {opt.label}
          </span>
          <span className="choice-answer-text">
            <LatexSpan
              text={opt.text}
              imagePaths={imagePaths}
              imageScaleStyles={imageScaleStyles}
              imageClassName="question-image-option"
            />
          </span>
          {optionBadges(opt.label)}
        </div>
      ))}

      {shouldShowSubmit && (
        <button
          className={`choice-answer-submit${submitting ? ' is-submitting' : ''}`}
          onClick={onSubmit}
          disabled={submitting}
        >
          {submitting ? '提交中...' : collectMode ? '确认' : '提交答案'}
        </button>
      )}
    </div>
  );
}
