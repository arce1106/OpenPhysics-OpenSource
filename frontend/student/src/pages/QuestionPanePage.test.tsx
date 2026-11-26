import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuestionPanePage from './QuestionPanePage';
import type { Question } from '../types';

const sampleQuestion: Question = {
  id: 'q-web-pane-1',
  stem_text: '在测量纸带的速度实验中，选择正确做法。',
  question_type: 'single_choice',
  options: [
    { label: 'A', text: '先接通电源' },
    { label: 'B', text: '先释放纸带' },
  ],
  images: [],
};

describe('QuestionPanePage Android bridge', () => {
  const onQuestionPaneReady = vi.fn();
  const onQuestionReady = vi.fn();
  const onOptionSelected = vi.fn();
  const onAnswerChanged = vi.fn();
  const onQuestionError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.OpenPhysicsBridge = {
      onQuestionPaneReady,
      onQuestionReady,
      onOptionSelected,
      onAnswerChanged,
      onQuestionError,
    };
  });

  afterEach(() => {
    delete window.OpenPhysicsBridge;
    delete window.OpenPhysicsAndroidQuestionPane;
    delete window.OpenPhysicsQuestionPane;
  });

  it('signals pane ready once and does not ask Android to reinject after setQuestion', async () => {
    render(<QuestionPanePage />);

    expect(onQuestionPaneReady).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onQuestionPaneReady.mock.calls[0][0])).toEqual({ ready: true });

    act(() => {
      window.OpenPhysicsQuestionPane?.setQuestion({
        question: sampleQuestion,
        selectedOptions: [],
      });
    });

    expect(await screen.findByText(sampleQuestion.stem_text)).toBeInTheDocument();
    expect(onQuestionPaneReady).toHaveBeenCalledTimes(1);
    expect(onQuestionReady).not.toHaveBeenCalled();
  });

  it('renders injected question content and sends one selected choice callback to Android', async () => {
    const { container } = render(<QuestionPanePage />);

    act(() => {
      window.OpenPhysicsQuestionPane?.setQuestion({
        question: sampleQuestion,
        selectedOptions: [],
      });
    });

    expect(await screen.findByText(sampleQuestion.stem_text)).toBeInTheDocument();
    expect(container.querySelector('.question-display-surface')).not.toBeNull();
    await userEvent.click(screen.getByText('先接通电源'));

    expect(onOptionSelected).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(onOptionSelected.mock.calls[0][0]);
    expect(payload).toMatchObject({
      questionId: 'q-web-pane-1',
      questionType: 'single_choice',
      answer: 'A',
      selectedOptions: ['A'],
    });
    expect(onAnswerChanged).not.toHaveBeenCalled();
  });

  it('syncs an empty answer when a multi-choice selection is cleared', async () => {
    render(<QuestionPanePage />);

    act(() => {
      window.OpenPhysicsQuestionPane?.setQuestion({
        question: {
          ...sampleQuestion,
          id: 'q-web-pane-multi',
          question_type: 'multiple_choice',
        },
        selectedOptions: [],
      });
    });

    await userEvent.click(await screen.findByText('先接通电源'));
    await userEvent.click(screen.getByText('先接通电源'));

    expect(onOptionSelected).toHaveBeenCalledTimes(2);
    expect(JSON.parse(onOptionSelected.mock.calls[1][0])).toMatchObject({
      questionId: 'q-web-pane-multi',
      selectedOptions: [],
      answer: '',
    });
  });

  it('syncs an empty answer when a single-choice selection is tapped again', async () => {
    render(<QuestionPanePage />);

    act(() => {
      window.OpenPhysicsQuestionPane?.setQuestion({
        question: sampleQuestion,
        selectedOptions: [],
      });
    });

    await userEvent.click(await screen.findByText('先接通电源'));
    await userEvent.click(screen.getByText('先接通电源'));

    expect(onOptionSelected).toHaveBeenCalledTimes(2);
    expect(JSON.parse(onOptionSelected.mock.calls[1][0])).toMatchObject({
      questionId: 'q-web-pane-1',
      selectedOptions: [],
      answer: '',
    });
  });

  it('renders readonly injected questions without sending choice callbacks', async () => {
    const { container } = render(<QuestionPanePage />);

    act(() => {
      window.OpenPhysicsQuestionPane?.setQuestion({
        question: sampleQuestion,
        selectedOptions: ['A'],
        mode: 'readonly',
      });
    });

    await userEvent.click(await screen.findByText('先释放纸带'));

    expect(onOptionSelected).not.toHaveBeenCalled();
    expect(container.querySelector('.android-question-pane-readonly')).toBeTruthy();
  });

  it('falls back to the legacy Android bridge name when the cross-platform bridge is absent', async () => {
    delete window.OpenPhysicsBridge;
    window.OpenPhysicsAndroidQuestionPane = {
      onQuestionPaneReady,
      onOptionSelected,
      onQuestionError,
    };

    render(<QuestionPanePage />);

    expect(onQuestionPaneReady).toHaveBeenCalledTimes(1);

    act(() => {
      window.OpenPhysicsQuestionPane?.setQuestion({
        question: sampleQuestion,
        selectedOptions: [],
      });
    });

    await userEvent.click(await screen.findByText('先释放纸带'));

    expect(onOptionSelected).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onOptionSelected.mock.calls[0][0])).toMatchObject({
      answer: 'B',
      selectedOptions: ['B'],
    });
  });

  it('reports malformed injected payload as a question error instead of crashing', () => {
    render(<QuestionPanePage />);

    act(() => {
      window.OpenPhysicsQuestionPane?.setQuestion('{bad-json');
    });

    expect(screen.getByRole('heading', { name: '题目加载失败' })).toBeInTheDocument();
    expect(JSON.parse(onQuestionError.mock.calls[0][0]).message).toContain('JSON');
  });
});
