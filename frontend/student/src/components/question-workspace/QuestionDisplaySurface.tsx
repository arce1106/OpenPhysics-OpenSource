import { useMemo } from 'react';
import { getImageScaleStyle } from '../../../../shared/questionImageDisplay';
import type { Question, SubmitResult } from '../../types';
import ChoiceAnswerPanel from './ChoiceAnswerPanel';
import QuestionStemPanel from './QuestionStemPanel';

type ImageScaleStyle = Record<string, string> | undefined;

interface QuestionDisplaySurfaceProps {
  question: Question;
  selected?: string | null;
  multiSelected?: Set<string>;
  isMultiChoice?: boolean;
  isDone?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  submitting?: boolean;
  collectMode?: boolean;
  deferredGrading?: boolean;
  result?: SubmitResult | null;
  imageScaleStyles?: ImageScaleStyle[];
  className?: string;
  onSelect?: (label: string) => void;
  onSubmit?: () => void;
}

function answerToMultiSelected(selected: string | null | undefined) {
  return new Set(
    (selected || '')
      .replace(/[,，、\s]/g, '')
      .split('')
      .filter(Boolean),
  );
}

function inferMultiChoice(question: Question) {
  return question.question_type === 'multiple_choice' || question.stem_text.includes('多选');
}

export default function QuestionDisplaySurface({
  question,
  selected = null,
  multiSelected,
  isMultiChoice = inferMultiChoice(question),
  isDone = false,
  disabled = false,
  readOnly = false,
  submitting = false,
  collectMode = false,
  deferredGrading = true,
  result = null,
  imageScaleStyles,
  className,
  onSelect = () => undefined,
  onSubmit = () => undefined,
}: QuestionDisplaySurfaceProps) {
  const resolvedImageScaleStyles = useMemo(
    () => imageScaleStyles || question.images?.map(img => getImageScaleStyle(img)),
    [imageScaleStyles, question.images],
  );
  const resolvedMultiSelected = useMemo(
    () => multiSelected || answerToMultiSelected(selected),
    [multiSelected, selected],
  );
  const selectedLabel = isMultiChoice ? null : selected;
  const answerDisabled = disabled || readOnly;
  const handleSelect = readOnly ? () => undefined : onSelect;

  return (
    <section className={['question-display-surface', className].filter(Boolean).join(' ')}>
      <QuestionStemPanel question={question} />
      {question.options.length > 0 && (
        <ChoiceAnswerPanel
          question={question}
          selected={selectedLabel}
          multiSelected={resolvedMultiSelected}
          isMultiChoice={isMultiChoice}
          isDone={isDone}
          disabled={answerDisabled}
          submitting={submitting}
          collectMode={collectMode}
          deferredGrading={deferredGrading}
          result={result}
          imageScaleStyles={resolvedImageScaleStyles}
          onSelect={handleSelect}
          onSubmit={onSubmit}
        />
      )}
    </section>
  );
}
