import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { Question, SubmitResult } from '../../types';
import SelfReviewPanel from './SelfReviewPanel';

vi.mock('../../api/client', () => ({
  api: {
    submitSelfReview: vi.fn(),
  },
}));

const selfReviewResult: SubmitResult = {
  answer_id: 91,
  is_correct: false,
  correct_answer: '(1)6 s　(2)60 m/s',
  explanation: '先由 h=1/2gt^2 求时间，再由 v=gt 求速度。',
  mastery_update: {},
  extracted_answer: '自评：(1)完全正确；(2)部分正确',
  process_grading: {
    answer_source: 'self_review',
    confidence_level: 'low',
    needs_human_review: true,
  },
};

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q_self_review',
    stem_text: '计算：(1)落地时间；(2)落地速度',
    question_type: 'problem_solving',
    options: [],
    answer: '(1)6 s　(2)60 m/s',
    explanation: '先由 h=1/2gt^2 求时间，再由 v=gt 求速度。',
    ...overrides,
  };
}

describe('SelfReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.submitSelfReview).mockResolvedValue(selfReviewResult);
  });

  it('shows answer and explanation after expanding and requires every sub-question to be reviewed', async () => {
    const onResult = vi.fn();
    render(
      <SelfReviewPanel
        question={makeQuestion()}
        getTimeSpentMs={() => 1234}
        onResult={onResult}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '对照解析自评' }));

    expect(screen.getByText(/60 m\/s/)).toBeInTheDocument();
    expect(document.body).toHaveTextContent('先由');
    expect(screen.getByRole('button', { name: '提交自评' })).toBeDisabled();

    await userEvent.click(screen.getAllByRole('button', { name: '全对' })[0]);
    expect(screen.getByRole('button', { name: '提交自评' })).toBeDisabled();

    await userEvent.click(screen.getAllByRole('button', { name: '半对' })[1]);
    await userEvent.click(screen.getByRole('button', { name: '提交自评' }));

    await waitFor(() => {
      expect(api.submitSelfReview).toHaveBeenCalledWith({
        question_id: 'q_self_review',
        items: [
          { label: '(1)', status: 'correct' },
          { label: '(2)', status: 'partial' },
        ],
        time_spent_ms: 1234,
      });
    });
    expect(onResult).toHaveBeenCalledWith(selfReviewResult);
  });

  it('uses rendered rich content for answer and explanation when available', async () => {
    const { container } = render(
      <SelfReviewPanel
        question={makeQuestion({
          correct_answer: 'fallback answer',
          correct_answer_rendered: {
            html: '<span class="katex">v=gt</span>',
            errors: [],
          },
          explanation: 'fallback explanation',
          explanation_rendered: {
            html: '<span class="katex">h=\\frac12gt^2</span>',
            errors: [],
          },
        })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '对照解析自评' }));

    expect(container.querySelectorAll('.rich-content-rendered .katex')).toHaveLength(2);
    expect(screen.queryByText('fallback answer')).not.toBeInTheDocument();
    expect(screen.queryByText('fallback explanation')).not.toBeInTheDocument();
  });
});
