import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GradingResultPanel,
  QuestionDisplaySurface,
} from '../components/question-workspace';
import type { Question, SubmitResult } from '../types';
import { getImageScaleStyle } from '../../../shared/questionImageDisplay';
import './QuestionPanePage.css';

type QuestionPanePayload = {
  question: Question;
  index?: number;
  total?: number;
  selectedOptions?: string[];
  answerState?: QuestionPaneAnswerState | null;
  mode?: 'interactive' | 'readonly';
};

type QuestionPaneAnswerState = {
  submitted?: boolean;
  correct?: boolean;
  correctAnswer?: string | null;
  explanation?: string | null;
  extractedAnswer?: string | null;
  aiFeedback?: string | null;
};

type AndroidQuestionPaneBridge = {
  onQuestionPaneReady?: (payload: string) => void;
  onQuestionReady?: (payload: string) => void;
  onOptionSelected?: (payload: string) => void;
  onAnswerChanged?: (payload: string) => void;
  onOpenImage?: (payload: string) => void;
  onQuestionError?: (payload: string) => void;
};

declare global {
  interface Window {
    OpenPhysicsBridge?: AndroidQuestionPaneBridge;
    OpenPhysicsAndroidQuestionPane?: AndroidQuestionPaneBridge;
    OpenPhysicsQuestionPane?: {
      setQuestion: (payload: string | QuestionPanePayload) => void;
      setAnswerState: (payload: string | QuestionPaneAnswerState | null) => void;
      showAnalysis: (payload: string | QuestionPaneAnswerState | null) => void;
      setTheme: (payload: string) => void;
      setFontScale: (payload: string | number) => void;
    };
  }
}

function parsePayload<T>(payload: string | T): T {
  if (typeof payload === 'string') return JSON.parse(payload) as T;
  return payload;
}

function normalizeLabels(labels: string[] | undefined): string[] {
  return Array.from(new Set((labels || []).map(label => label.trim()).filter(Boolean))).sort();
}

function labelsToAnswer(labels: string[]): string {
  return normalizeLabels(labels).join('');
}

function answerToLabels(answer: string | null | undefined): string[] {
  return normalizeLabels((answer || '').replace(/[,，、\s]/g, '').split(''));
}

function makeSubmitResult(state: QuestionPaneAnswerState | null, selectedOptions: string[]): SubmitResult | null {
  if (!state?.submitted) return null;
  return {
    is_correct: Boolean(state.correct),
    correct_answer: state.correctAnswer || '',
    explanation: state.explanation || null,
    ai_feedback: state.aiFeedback || null,
    extracted_answer: state.extractedAnswer || labelsToAnswer(selectedOptions),
    mastery_update: {},
  };
}

function postToAndroid(method: keyof AndroidQuestionPaneBridge, payload: Record<string, unknown>) {
  try {
    const message = JSON.stringify(payload);
    const bridge = window.OpenPhysicsBridge || window.OpenPhysicsAndroidQuestionPane;
    bridge?.[method]?.(message);
  } catch {
    // Android side treats bridge messages as best-effort UI synchronization.
  }
}

export default function QuestionPanePage() {
  const [question, setQuestion] = useState<Question | null>(null);
  const [position, setPosition] = useState<{ index?: number; total?: number }>({});
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [answerState, setAnswerState] = useState<QuestionPaneAnswerState | null>(null);
  const [mode, setMode] = useState<'interactive' | 'readonly'>('interactive');
  const [fontScale, setFontScale] = useState(1);
  const [error, setError] = useState('');

  const isMultiChoice = question?.question_type === 'multiple_choice';
  const readOnly = mode === 'readonly';
  const result = useMemo(() => makeSubmitResult(answerState, selectedOptions), [answerState, selectedOptions]);
  const imageScaleStyles = question?.images?.map(img => getImageScaleStyle(img));

  const applyQuestionPayload = useCallback((payload: string | QuestionPanePayload) => {
    try {
      const next = parsePayload<QuestionPanePayload>(payload);
      if (!next?.question?.id) throw new Error('question.id is required');
      const labels = normalizeLabels(
        next.selectedOptions || answerToLabels(next.answerState?.extractedAnswer),
      );
      setQuestion(next.question);
      setPosition({ index: next.index, total: next.total });
      setSelectedOptions(labels);
      setAnswerState(next.answerState || null);
      setMode(next.mode === 'readonly' ? 'readonly' : 'interactive');
      setError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '题目载入失败';
      setError(message);
      postToAndroid('onQuestionError', { message });
    }
  }, []);

  const applyAnswerState = useCallback((payload: string | QuestionPaneAnswerState | null) => {
    try {
      setAnswerState(payload == null ? null : parsePayload<QuestionPaneAnswerState>(payload));
    } catch (err) {
      const message = err instanceof Error ? err.message : '答案状态更新失败';
      setError(message);
      postToAndroid('onQuestionError', { questionId: question?.id || '', message });
    }
  }, [question?.id]);

  useEffect(() => {
    window.OpenPhysicsQuestionPane = {
      setQuestion: applyQuestionPayload,
      setAnswerState: applyAnswerState,
      showAnalysis: applyAnswerState,
      setTheme: () => undefined,
      setFontScale: (payload) => {
        const value = typeof payload === 'string' ? Number(payload) : payload;
        if (Number.isFinite(value)) setFontScale(Math.min(1.3, Math.max(0.86, value)));
      },
    };
    return () => {
      delete window.OpenPhysicsQuestionPane;
    };
  }, [applyAnswerState, applyQuestionPayload]);

  useEffect(() => {
    postToAndroid('onQuestionPaneReady', { ready: true });
  }, []);

  const handleSelect = (label: string) => {
    if (!question || answerState?.submitted || readOnly) return;
    const next = isMultiChoice
      ? selectedOptions.includes(label)
        ? selectedOptions.filter(item => item !== label)
        : normalizeLabels([...selectedOptions, label])
      : selectedOptions.includes(label) ? [] : [label];
    setSelectedOptions(next);
    const payload = {
      questionId: question.id,
      questionType: question.question_type || '',
      selectedOptions: next,
      answer: labelsToAnswer(next),
    };
    postToAndroid('onOptionSelected', payload);
  };

  if (error) {
    return (
      <main className="android-question-pane android-question-pane-state">
        <h1>题目加载失败</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!question) {
    return (
      <main className="android-question-pane android-question-pane-state" data-testid="android-question-pane-loading">
        <div className="android-question-pane-skeleton" />
        <div className="android-question-pane-skeleton short" />
      </main>
    );
  }

  return (
    <main
      className={`android-question-pane${readOnly ? ' android-question-pane-readonly' : ''}`}
      style={{ fontSize: `${fontScale}rem` }}
    >
      <div className="android-question-pane-header">
        {position.index != null && position.total != null && (
          <span>第 {position.index + 1}/{position.total} 题</span>
        )}
        <strong>{question.question_type === 'multiple_choice' ? '多选题' : question.options.length ? '选择题' : '题目'}</strong>
      </div>
      <QuestionDisplaySurface
        question={question}
        selected={isMultiChoice ? null : selectedOptions[0] || null}
        multiSelected={new Set(selectedOptions)}
        isMultiChoice={isMultiChoice}
        isDone={Boolean(answerState?.submitted)}
        disabled={readOnly}
        readOnly={readOnly}
        submitting={false}
        deferredGrading
        result={result}
        imageScaleStyles={imageScaleStyles}
        onSelect={handleSelect}
        onSubmit={() => undefined}
      />
      {result && (
        <GradingResultPanel
          question={question}
          result={result}
          resultStatus={{
            label: result.is_correct ? '回答正确' : '需要订正',
            background: result.is_correct ? '#f6ffed' : '#fffbe6',
            border: result.is_correct ? '#b7eb8f' : '#ffe58f',
            color: result.is_correct ? '#389e0d' : '#ad6800',
            aiFeedbackBackground: '#f8fafc',
            aiFeedbackBorder: '#dde7ee',
            aiFeedbackColor: '#334155',
          }}
          imageScaleStyles={imageScaleStyles}
          correctionText=""
          correctionLoading={false}
          correctionError={null}
          givenAnswer={labelsToAnswer(selectedOptions)}
          onCorrectionTextChange={() => undefined}
          onManualCorrection={() => undefined}
        />
      )}
    </main>
  );
}
