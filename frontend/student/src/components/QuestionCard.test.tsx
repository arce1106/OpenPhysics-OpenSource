import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import QuestionCard from './QuestionCard';
import type { Question, SubmitResult } from '../types';

const apiMocks = vi.hoisted(() => ({
  questionTutorChat: vi.fn(),
  correctAnswer: vi.fn(),
  submitSelfReview: vi.fn(),
}));

const submitResult: SubmitResult = {
  is_correct: true,
  correct_answer: 'A',
  explanation: null,
  mastery_update: {},
  extracted_answer: '作答结果',
};

vi.mock('./HandwritingPad', () => ({
  default: ({
    onResult,
    onSnapshotChange,
    submitEnabled = true,
    footerLeadingActions,
    footerActions,
  }: {
    onResult: (result: SubmitResult) => void;
    onSnapshotChange?: (snapshot: any) => void;
    submitEnabled?: boolean;
    footerLeadingActions?: ReactNode;
    footerActions?: ReactNode;
  }) => {
    const React = require('react');
    React.useEffect(() => () => {
      onSnapshotChange?.({
        version: 1,
        width: 320,
        height: 240,
        strokes: [{ tool: 'pen', color: '#1f2933', width: 2.5, points: [{ x: 1, y: 1, t: 1 }] }],
      });
    }, [onSnapshotChange]);
    return (
      <div>
        <button type="button" onClick={() => onResult(submitResult)}>
          mock handwriting pad
        </button>
        <div className="handwriting-pad__footer">
          {footerLeadingActions && (
            <div className="handwriting-pad__footer-leading">{footerLeadingActions}</div>
          )}
          <div className="handwriting-pad__footer-trailing">
            {submitEnabled && <button type="button">提交手写答案</button>}
            {footerActions}
          </div>
        </div>
      </div>
    );
  },
}));

vi.mock('./PhotoUpload', () => ({
  default: ({ onResult }: { onResult: (result: SubmitResult) => void }) => (
    <button type="button" onClick={() => onResult(submitResult)}>
      mock photo upload
    </button>
  ),
}));

vi.mock('../api/client', () => ({
  api: apiMocks,
}));

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    stem_text: '请作答',
    question_type: 'problem_solving',
    options: [],
    images: [],
    answer: '规范答案',
    explanation: '标准解析',
    ...overrides,
  };
}

describe('QuestionCard', () => {
  it('keeps a saved paper review focused on the question and feedback without a new writing canvas', async () => {
    const { container, rerender } = render(<QuestionCard question={{ id: 'review-q', stem_text: '已完成题目', question_type: 'single_choice', options: [{ label: 'A', text: '选项' }] }}
      disabled externalResult={{ ...submitResult, extracted_answer: 'A' }} reviewMode />);
    expect(await screen.findByText('已完成题目')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'mock handwriting pad' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交答案' })).not.toBeInTheDocument();
    expect(container.querySelector('.question-card-workspace')).toHaveClass('is-review-mode');
    expect(container.querySelector('.question-card-answer-region')).toBeNull();
    rerender(<QuestionCard question={makeQuestion()} disabled={false} />);
    expect(container.querySelector('.question-card-workspace')).not.toHaveClass('is-review-mode');
    expect(container.querySelector('.question-card-answer-region')).not.toBeNull();
  });

  it('uses handwriting input for graph construction questions', () => {
    render(
      <QuestionCard
        question={makeQuestion({ question_type: 'graph_construction' })}
        onAnswer={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'mock handwriting pad' })).toBeInTheDocument();
  });

  it('notifies the parent page when handwriting grading finishes', async () => {
    const onAnswered = vi.fn();
    render(
      <QuestionCard
        question={makeQuestion()}
        onAnswer={vi.fn()}
        onAnswered={onAnswered}
        disabled={false}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'mock handwriting pad' }));

    expect(onAnswered).toHaveBeenCalledWith('q1', submitResult);
  });

  it('keeps AI photo grading visible in collect mode before final assessment submission', async () => {
    const onAnswered = vi.fn();
    const onCollect = vi.fn();
    render(
      <QuestionCard
        question={makeQuestion()}
        onAnswered={onAnswered}
        onCollect={onCollect}
        collectMode
        disabled={false}
      />,
    );

    await userEvent.click(screen.getByText('拍照上传纸面解答'));
    await userEvent.click(screen.getByRole('button', { name: 'mock photo upload' }));

    expect(onAnswered).toHaveBeenCalledWith('q1', submitResult);
    expect(onCollect).toHaveBeenCalledWith('q1', '作答结果');
    expect(screen.getByText(/AI 识别答案/)).toBeInTheDocument();
    expect(screen.getByText('作答结果')).toBeInTheDocument();
  });

  it('removes direct text input for non-choice questions', () => {
    render(
      <QuestionCard
        question={makeQuestion({ question_type: 'fill_in_blank' })}
        onAnswer={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.queryByPlaceholderText('请输入你的答案...')).not.toBeInTheDocument();
    expect(screen.queryByText('或直接输入答案')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'mock handwriting pad' })).toBeInTheDocument();
  });

  it('aligns self-review on the left and handwriting/photo actions on the right for written questions', () => {
    const { container } = render(
      <QuestionCard
        question={makeQuestion()}
        onAnswer={vi.fn()}
        disabled={false}
      />,
    );

    const leading = container.querySelector('.handwriting-pad__footer-leading');
    const trailing = container.querySelector('.handwriting-pad__footer-trailing');

    expect(leading).toContainElement(screen.getByRole('button', { name: '对照解析自评' }));
    expect(trailing).toContainElement(screen.getByRole('button', { name: '提交手写答案' }));
    expect(trailing).toContainElement(screen.getByRole('button', { name: '拍照上传纸面解答' }));
  });

  it('shows the right-side handwriting draft workspace on choice question cards', () => {
    const { container } = render(
      <QuestionCard
        question={makeQuestion({
          question_type: 'single_choice',
          options: [{ label: 'A', text: '选项 A' }],
        })}
        onAnswer={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'mock handwriting pad' })).toBeInTheDocument();
    expect(container.querySelector('.question-card-stem-region .choice-answer-panel')).not.toBeNull();
    expect(container.querySelector('.question-card-answer-region .choice-answer-panel')).toBeNull();
  });

  it('lets students clear a single-choice answer by selecting it again', async () => {
    const onDraftChange = vi.fn();
    render(
      <QuestionCard
        question={makeQuestion({
          question_type: 'single_choice',
          options: [{ label: 'A', text: '选项 A' }, { label: 'B', text: '选项 B' }],
        })}
        onAnswer={vi.fn()}
        onDraftChange={onDraftChange}
        disabled={false}
      />,
    );

    const option = screen.getByText('选项 A').closest('.choice-answer-option');
    await userEvent.click(screen.getByText('选项 A'));
    expect(option).toHaveClass('is-selected');

    await userEvent.click(screen.getByText('选项 A'));
    expect(option).not.toHaveClass('is-selected');
    expect(onDraftChange).toHaveBeenNthCalledWith(1, 'q1', 'A');
    expect(onDraftChange).toHaveBeenNthCalledWith(2, 'q1', '');
    expect(screen.queryByRole('button', { name: '提交答案' })).not.toBeInTheDocument();
  });

  it('saves handwriting draft snapshots when the question card unmounts', () => {
    const onHandwritingDraftChange = vi.fn();
    const { unmount } = render(
      <QuestionCard
        question={makeQuestion({
          question_type: 'single_choice',
          options: [{ label: 'A', text: '选项 A' }],
        })}
        onAnswer={vi.fn()}
        disabled={false}
        onHandwritingDraftChange={onHandwritingDraftChange}
      />,
    );

    unmount();

    expect(onHandwritingDraftChange).toHaveBeenCalledWith('q1', expect.objectContaining({
      strokes: expect.arrayContaining([
        expect.objectContaining({ tool: 'pen' }),
      ]),
    }));
  });

  it('renders image placeholders inside choice options', () => {
    render(
      <QuestionCard
        question={makeQuestion({
          question_type: 'multiple_choice',
          images: [
            { id: 'img_stem', image_path: '/stem.png', image_type: 'diagram', description: null },
            { id: 'img_option_a', image_path: '/option-a.png', image_type: 'option', description: '选项A' },
          ],
          options: [{ label: 'A', text: '{{IMG:1}}' }],
        })}
        onAnswer={vi.fn()}
        disabled={false}
      />,
    );

    const imageSources = screen.getAllByRole('img', { name: '题目附图' })
      .map(img => img.getAttribute('src'));
    expect(imageSources).toContain('/option-a.png');
  });

  it('applies per-image display width metadata to question images', () => {
    render(
      <QuestionCard
        question={makeQuestion({
          stem_text: '观察{{IMG:0}}并作答',
          images: [
            {
              id: 'img_stem',
              image_path: '/stem.png',
              image_type: 'diagram',
              description: null,
              extracted_structure: { display_width_percent: 135 },
            },
          ],
        })}
        onAnswer={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByRole('img', { name: '题目附图' })).toHaveStyle({
      '--question-image-scale': '1.35',
    });
  });

  it('shows paper-batch answer image when an external result is provided', () => {
    render(
      <QuestionCard
        question={makeQuestion({ options: [{ label: 'A', text: '选项 A' }] })}
        onAnswer={vi.fn()}
        disabled
        externalResult={{
          ...submitResult,
          process_grading: {
            answer_image_path: '/static/uploads/answers/student/paper-crop-q1.jpg',
          },
        }}
      />,
    );

    expect(screen.getByText('学生作答图片')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '放大查看：学生作答图片' })).toBeInTheDocument();
  });

  it('describes non-choice process grading as partial credit instead of fully wrong', () => {
    render(
      <QuestionCard
        question={makeQuestion({ question_type: 'problem_solving', options: [] })}
        onAnswer={vi.fn()}
        disabled
        externalResult={{
          ...submitResult,
          is_correct: false,
          correct_answer: '$x=10$',
          extracted_answer: '$x=8$',
          process_grading: {
            process_score: 60,
            grading_basis: '建模正确，计算不完整。',
          },
        }}
      />,
    );

    expect(screen.getByText('△ 部分正确')).toBeInTheDocument();
    expect(screen.queryByText('✗ 回答错误')).not.toBeInTheDocument();
  });

  it('keeps the explanation section visible when a grading result has no explanation', () => {
    render(
      <QuestionCard
        question={makeQuestion({
          question_type: 'single_choice',
          options: [{ label: 'A', text: '选项 A' }, { label: 'B', text: '选项 B' }],
          explanation: null,
        })}
        onAnswer={vi.fn()}
        disabled
        externalResult={{
          ...submitResult,
          is_correct: false,
          correct_answer: 'A',
          explanation: null,
          extracted_answer: 'B',
        }}
      />,
    );

    expect(screen.getByText('解析')).toBeInTheDocument();
    expect(screen.getByText('暂无解析，可生成解析')).toBeInTheDocument();
  });

  it('keeps process grading details collapsed until the student asks for them', async () => {
    render(
      <QuestionCard
        question={makeQuestion()}
        onAnswer={vi.fn()}
        disabled
        externalResult={{
          ...submitResult,
          is_correct: false,
          correct_answer: '规范答案',
          explanation: '标准解析',
          process_grading: {
            grading_basis: '列式正确，计算有误。',
            process_score: 60,
          },
        }}
      />,
    );

    expect(screen.getByText('解析')).toBeInTheDocument();
    expect(screen.queryByText('判分依据：')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '查看详细批改' }));

    expect(screen.getByText('判分依据：')).toBeInTheDocument();
  });

  it('marks both the selected wrong choice and the correct choice after grading', () => {
    render(
      <QuestionCard
        question={makeQuestion({
          question_type: 'single_choice',
          options: [{ label: 'A', text: '选项 A' }, { label: 'B', text: '选项 B' }],
        })}
        onAnswer={vi.fn()}
        disabled
        initialAnswer="B"
        externalResult={{
          ...submitResult,
          is_correct: false,
          correct_answer: 'A',
          extracted_answer: null,
        }}
      />,
    );

    const correctOption = screen.getByText('选项 A').closest('.choice-answer-option');
    const selectedOption = screen.getByText('选项 B').closest('.choice-answer-option');

    expect(correctOption).toHaveClass('is-correct');
    expect(correctOption).toHaveTextContent('正确答案');
    expect(selectedOption).toHaveClass('is-wrong');
    expect(selectedOption).toHaveTextContent('我的选择');
  });

  it('lets students self-review a written answer and shows the grading result', async () => {
    const onAnswered = vi.fn();
    const onCollect = vi.fn();
    apiMocks.submitSelfReview.mockResolvedValueOnce({
      ...submitResult,
      answer_id: 92,
      is_correct: false,
      correct_answer: '(1)6 s　(2)60 m/s',
      explanation: '先由 h=1/2gt^2 求时间，再由 v=gt 求速度。',
      extracted_answer: '自评：(1)完全正确；(2)部分正确',
      process_grading: {
        answer_source: 'self_review',
        process_score: 75,
        confidence_level: 'low',
        needs_human_review: true,
      },
    });

    render(
      <QuestionCard
        question={makeQuestion({
          stem_text: '计算：(1)落地时间；(2)落地速度',
          answer: '(1)6 s　(2)60 m/s',
          explanation: '先由 h=1/2gt^2 求时间，再由 v=gt 求速度。',
        })}
        onAnswer={vi.fn()}
        onAnswered={onAnswered}
        onCollect={onCollect}
        collectMode
        disabled={false}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '对照解析自评' }));
    await userEvent.click(screen.getAllByRole('button', { name: '全对' })[0]);
    await userEvent.click(screen.getAllByRole('button', { name: '半对' })[1]);
    await userEvent.click(screen.getByRole('button', { name: '提交自评' }));

    expect(apiMocks.submitSelfReview).toHaveBeenCalledWith({
      question_id: 'q1',
      items: [
        { label: '(1)', status: 'correct' },
        { label: '(2)', status: 'partial' },
      ],
      time_spent_ms: 0,
    });
    expect(onAnswered).toHaveBeenCalledWith('q1', expect.objectContaining({
      extracted_answer: '自评：(1)完全正确；(2)部分正确',
    }));
    expect(onCollect).toHaveBeenCalledWith('q1', '自评：(1)完全正确；(2)部分正确');
    expect(await screen.findByText('△ 部分正确')).toBeInTheDocument();
  });

  it('does not show self-review on choice questions', () => {
    render(
      <QuestionCard
        question={makeQuestion({
          question_type: 'single_choice',
          options: [{ label: 'A', text: '选项 A' }],
        })}
        onAnswer={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.queryByRole('button', { name: '对照解析自评' })).not.toBeInTheDocument();
  });

  it('lets students continue asking about the current wrong question', async () => {
    apiMocks.questionTutorChat.mockResolvedValueOnce({ text: '先检查你选用的模型是否匹配题意。' });
    render(
      <QuestionCard
        question={makeQuestion({ stem_text: '小球下落，求加速度。' })}
        onAnswer={vi.fn()}
        disabled
        externalResult={{
          ...submitResult,
          is_correct: false,
          correct_answer: '$g$',
          explanation: '自由落体模型。',
          extracted_answer: '$2g$',
          process_grading: {
            first_error: '把自由落体加速度误认为 $2g$',
            error_type_name: '模型识别错误',
          },
        }}
      />,
    );

    expect(screen.queryByText('获取提示')).not.toBeInTheDocument();
    expect(screen.queryByText('引导提问')).not.toBeInTheDocument();
    expect(screen.queryByText('步骤拆解')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '打开AI助教' }));
    await userEvent.type(screen.getByLabelText('输入对这道题的追问'), '为什么不是2g？');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(apiMocks.questionTutorChat).toHaveBeenCalledWith({
      question_id: 'q1',
      given_answer: '$2g$',
      message: '为什么不是2g？',
      history: [],
      process_grading: {
        first_error: '把自由落体加速度误认为 $2g$',
        error_type_name: '模型识别错误',
      },
    });
    expect(await screen.findByText('先检查你选用的模型是否匹配题意。')).toBeInTheDocument();
  });
});
