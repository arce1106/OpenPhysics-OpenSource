import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import ReviewPage, { getReviewAnswerImagePaths, StudentAnswerDisplay } from './ReviewPage';
import type { ReviewData, ReviewMistake } from '../types';

const apiMocks = vi.hoisted(() => ({
  getReview: vi.fn(),
  getQuestionLessonVideo: vi.fn(),
  getVariations: vi.fn(),
  retrySimilar: vi.fn(),
  submitAnswer: vi.fn(),
  completeReview: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: apiMocks,
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'student-1',
  getStudentProfile: () => ({
    id: 'student-1',
    username: 'student',
    display_name: '学生',
    status: 'active',


  }),
}));

vi.mock('../components/QuestionTutorChat', () => ({
  default: ({
    questionId,
    givenAnswer,
    sideActions,
  }: {
    questionId: string;
    givenAnswer: string;
    sideActions?: any;
  }) => (
    <div data-testid="question-tutor-chat">
      追问入口 {questionId} {givenAnswer}
      {sideActions}
    </div>
  ),
}));

vi.mock('../components/QuestionCard', () => ({
  default: ({ question }: { question: { id: string; stem_text: string } }) => (
    <div data-testid="review-variant-question">
      {question.id} {question.stem_text}
    </div>
  ),
}));

vi.mock('../components/QuestionSessionRunner', () => ({
  default: ({
    title,
    subtitle,
    questions,
    answeredCount,
    onBack,
    onAnswer,
    onAnswered,
    showQuestionProgressNav,
    lastAction,
    persistenceKey,
  }: {
    title: string;
    subtitle: string;
    questions: Array<{ id: string; stem_text: string }>;
    answeredCount: number;
    onBack: () => void;
    onAnswer?: (questionId: string, answer: string) => Promise<any>;
    onAnswered?: (questionId: string, result: any) => void;
    showQuestionProgressNav?: boolean;
    lastAction?: ReactNode;
    persistenceKey?: string;
  }) => (
    <div data-testid="review-variant-session">
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <span>{answeredCount}/{questions.length}</span>
      <span data-testid="review-attempt">{persistenceKey}</span>
      <span data-testid="review-variant-progress-nav">{showQuestionProgressNav === false ? 'hidden' : 'visible'}</span>
      <div>{questions[0]?.id} {questions[0]?.stem_text}</div>
      <button type="button" onClick={onBack}>返回错题复盘页</button>
      {lastAction}
      <button
        type="button"
        onClick={async () => {
          const result = await onAnswer?.(questions[0]?.id || '', 'A');
          onAnswered?.(questions[0]?.id || '', result);
        }}
      >
        提交变式题
      </button>
    </div>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-path">{location.pathname}{location.search}</div>;
}

function renderReview(initialEntry = '/review') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/review/*" element={<><ReviewPage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

function makeMistake(overrides: Partial<ReviewMistake>): ReviewMistake {
  return {
    answer_id: 1,
    question_id: 'q_1',
    stem_text: '题干',
    given_answer: '[整套纸笔照片]',
    correct_answer: 'A',
    explanation: null,
    misconception: null,
    process_grading: null,
    created_at: '2026-05-16T00:00:00Z',
    ...overrides,
  };
}

function makeReviewData(): ReviewData {
  const modelMistake = makeMistake({
    answer_id: 2,
    question_id: 'q_model',
    stem_text: '自由落体的加速度是多少？',
    given_answer: '$2g$',
    correct_answer: '$g$',
    explanation: '自由落体近似只受重力，加速度为 $g$。',
    misconception: { id: 'model_error', name: '模型识别错误' },
    process_grading: {
      first_error: '把自由落体加速度误认为 $2g$',
      next_action: '先确认受力模型，再列运动关系。',
      error_type: 'model_error',
      error_type_name: '模型识别错误',
    },
  });
  const calcMistake = makeMistake({
    answer_id: 33,
    question_id: 'q_calc',
    stem_text: '速度错题',
    given_answer: 'B',
    correct_answer: 'C',
    misconception: { id: 'calculation_error', name: '计算错误' },
    process_grading: {
      first_error: '代入速度公式时平方项计算错误',
      next_action: '重做一题同类速度计算。',
      error_type: 'calculation_error',
      error_type_name: '计算错误',
    },
  });
  const paperMistake = makeMistake({
    answer_id: 7,
    question_id: 'q_print',
    stem_text: '打印错题题干',
    process_grading: {
      answer_image_paths: ['/uploads/answer-page-1.png'],
      error_type: 'model_error',
      error_type_name: '模型识别错误',
    },
  });

  return {
    clearance_progress: { reviewed: 1, total: 4 },
    review_center: {
      total_pending: 3,
      primary_focus: {
        error_type: 'model_error',
        error_name: '模型识别错误',
        count: 2,
        kp_names: ['自由落体运动', '楞次定律'],
        sample_answer_id: 2,
        sample_question_id: 'q_model',
        first_error: '把自由落体加速度误认为 $2g$',
        next_action: '先确认受力模型，再列运动关系。',
      },
      error_groups: [
        {
          error_type: 'model_error',
          error_name: '模型识别错误',
          count: 2,
          kp_names: ['自由落体运动', '楞次定律'],
          sample_answer_id: 2,
          sample_question_id: 'q_model',
          first_error: '把自由落体加速度误认为 $2g$',
          next_action: '先确认受力模型，再列运动关系。',
        },
        {
          error_type: 'calculation_error',
          error_name: '计算错误',
          count: 1,
          kp_names: ['速度'],
          sample_answer_id: 33,
          sample_question_id: 'q_calc',
          first_error: '代入速度公式时平方项计算错误',
          next_action: '重做一题同类速度计算。',
        },
      ],
      review_steps: [
        { title: '定位第一处错误', description: '把自由落体加速度误认为 $2g$' },
        { title: '对照正确解法', description: '对照解析修正关键一步。' },
        { title: '做同类变式确认', description: '完成一题同类变式。' },
      ],
      stage_counts: { 待复盘: 3, 错因明确: 2, 需要人工确认: 0 },
    },
    groups: [
      {
        kp_id: 'kp-model',
        kp_name: '自由落体运动',
        wrong_count: 1,
        mistakes: [modelMistake],
      },
      {
        kp_id: 'kp-speed',
        kp_name: '速度',
        wrong_count: 1,
        mistakes: [calcMistake],
      },
      {
        kp_id: 'kp-print',
        kp_name: '楞次定律',
        wrong_count: 1,
        mistakes: [paperMistake],
      },
    ],
  };
}

describe('ReviewPage student answer display', () => {
  beforeEach(() => {
    apiMocks.getReview.mockReset();
    apiMocks.getVariations.mockReset();
    apiMocks.retrySimilar.mockReset();
    apiMocks.submitAnswer.mockReset();
    apiMocks.completeReview.mockReset();
  });

  const variation = (id: string) => ({ variations: [{
    variation_type: 'foundation', title: '变式', reason: '同类练习',
    question: { id, stem_text: id, question_type: 'single_choice', options: [] },
  }] });

  async function failFirstVariation() {
    apiMocks.getReview.mockResolvedValue(makeReviewData());
    apiMocks.getVariations.mockResolvedValueOnce(variation('q_old')).mockResolvedValue(variation('q_new'));
    apiMocks.submitAnswer.mockResolvedValue({ answer_id: 9001, is_correct: false, correct_answer: 'B', explanation: '错误', mastery_update: {} });
    const page = renderReview('/review/mistake/33');
    await userEvent.click(await screen.findByRole('button', { name: '做变式题' }));
    const oldAttempt = screen.getByTestId('review-attempt').textContent;
    await userEvent.click(await screen.findByRole('button', { name: '提交变式题' }));
    await screen.findByRole('button', { name: '再练一道' });
    return { page, oldAttempt };
  }

  it('offers the question video alongside AI and does not clear the mistake when watching', async () => {
    const data = makeReviewData();
    const mistake = data.groups.flatMap(group => group.mistakes).find(item => item.answer_id === 33)!;
    mistake.lesson_video = { id: 'lesson', title: '错题讲解', duration_seconds: 60, available: true };
    apiMocks.getReview.mockResolvedValue(data);
    apiMocks.getQuestionLessonVideo.mockResolvedValue({ question_id: mistake.question_id, title: '错题讲解', duration_seconds: 60, video_url: '/media/signed' });
    renderReview('/review/mistake/33');
    await userEvent.click(await screen.findByRole('button', { name: '视频讲解' }));
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('错题讲解');
    expect(screen.getByTestId('question-tutor-chat')).toBeInTheDocument();
    expect(apiMocks.getQuestionLessonVideo).toHaveBeenCalledWith(mistake.question_id, 33);
    expect(apiMocks.completeReview).not.toHaveBeenCalled();
  });

  it('starts a new variation after a wrong answer and clears the original only after a correct retry', async () => {
    const { oldAttempt } = await failFirstVariation();
    await userEvent.click(screen.getByRole('button', { name: '再练一道' }));
    await waitFor(() => expect(screen.getByTestId('review-variant-session')).toHaveTextContent('q_new'));
    expect(apiMocks.getVariations).toHaveBeenLastCalledWith(33, 'student-1', ['q_old']);
    expect(screen.getByTestId('review-variant-session')).toHaveTextContent('0/1');
    expect(screen.getByTestId('review-attempt').textContent).not.toBe(oldAttempt);
    expect(apiMocks.completeReview).not.toHaveBeenCalled();
    apiMocks.submitAnswer.mockResolvedValue({ answer_id: 9002, is_correct: true, correct_answer: 'A', explanation: '正确', mastery_update: {} });
    apiMocks.completeReview.mockResolvedValue({ cleared: true });
    await userEvent.click(screen.getByRole('button', { name: '提交变式题' }));
    await waitFor(() => expect(apiMocks.completeReview).toHaveBeenCalledOnce());
    expect(apiMocks.submitAnswer.mock.calls[0][1].submission_id).not.toBe(apiMocks.submitAnswer.mock.calls[1][1].submission_id);
  });

  it('can continue a failed review after remount without restoring its old result into the new round', async () => {
    const { page } = await failFirstVariation();
    page.unmount();
    renderReview('/review/mistake/33');
    await userEvent.click(await screen.findByRole('button', { name: '做变式题' }));
    await waitFor(() => expect(screen.getByTestId('review-variant-session')).toHaveTextContent('q_new'));
    expect(screen.getByTestId('review-variant-session')).toHaveTextContent('0/1');
    expect(apiMocks.getVariations).toHaveBeenCalledTimes(2);
  });

  it('retains the graded question when no further appropriate variation is available', async () => {
    await failFirstVariation();
    apiMocks.getVariations.mockResolvedValue({ variations: [] });
    apiMocks.retrySimilar.mockResolvedValue({ question: null });
    await userEvent.click(screen.getByRole('button', { name: '再练一道' }));
    await screen.findByText('暂时没有更多合适的变式题，可先回看解析，稍后再练。');
    expect(screen.getByTestId('review-variant-session')).toHaveTextContent('q_old');
    expect(screen.getByTestId('review-variant-session')).toHaveTextContent('1/1');
    expect(apiMocks.retrySimilar).toHaveBeenCalledWith(33, 'student-1', ['q_old']);
    expect(apiMocks.completeReview).not.toHaveBeenCalled();
  });

  it('restores an unfinished variation without fetching another question', async () => {
    apiMocks.getReview.mockResolvedValue(makeReviewData());
    apiMocks.getVariations.mockResolvedValue(variation('q_unfinished'));
    const page = renderReview('/review/mistake/33');
    await userEvent.click(await screen.findByRole('button', { name: '做变式题' }));
    const attempt = screen.getByTestId('review-attempt').textContent;
    page.unmount();
    renderReview('/review/mistake/33/variation');
    await screen.findByTestId('review-variant-session');
    expect(screen.getByTestId('review-variant-session')).toHaveTextContent('q_unfinished');
    expect(screen.getByTestId('review-attempt').textContent).toBe(attempt);
    expect(apiMocks.getVariations).toHaveBeenCalledOnce();
  });

  it('prefers multiple paper answer images over the single-image fallback', () => {
    const mistake = makeMistake({
      process_grading: {
        answer_image_path: '/uploads/single.png',
        answer_image_paths: ['/uploads/page-1.png', '/uploads/page-2.png'],
      },
    });

    expect(getReviewAnswerImagePaths(mistake)).toEqual(['/uploads/page-1.png', '/uploads/page-2.png']);
  });

  it('falls back to page-level answer images when the primary image fields are missing', () => {
    const mistake = makeMistake({
      process_grading: {
        answer_page_image_paths: ['/uploads/page-fallback-1.png', '/uploads/page-fallback-2.png'],
      },
    });

    expect(getReviewAnswerImagePaths(mistake)).toEqual([
      '/uploads/page-fallback-1.png',
      '/uploads/page-fallback-2.png',
    ]);
  });

  it('shows paper answer images in the review notebook without the placeholder text', () => {
    render(<StudentAnswerDisplay mistake={makeMistake({
      process_grading: {
        answer_image_paths: ['/uploads/page-1.png', '/uploads/page-2.png'],
      },
    })} />);

    expect(screen.queryByText('[整套纸笔照片]')).not.toBeInTheDocument();
    expect(screen.getByAltText('学生作答图片 1')).toHaveAttribute('src', '/uploads/page-1.png');
    expect(screen.getByAltText('学生作答图片 2')).toHaveAttribute('src', '/uploads/page-2.png');
  });

  it('renders the review notebook as a tablet workspace entrance without spreading mistakes on the home page', async () => {
    apiMocks.getReview.mockResolvedValue(makeReviewData());

    const { container } = renderReview('/review');

    expect(await screen.findByRole('heading', { name: '错题本' })).toBeInTheDocument();
    expect(screen.getByText('复盘控制面板')).toBeInTheDocument();
    expect(screen.getByText('本轮重点')).toBeInTheDocument();
    expect(screen.queryByText('下一步')).not.toBeInTheDocument();
    expect(screen.queryByText('进入完整复盘')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '进入错题复盘' })).not.toBeInTheDocument();
    expect(container.querySelector('.review-control-panel')).toHaveTextContent('优先处理');
    expect(container.querySelector('.review-control-panel')).toHaveTextContent('模型识别错误');
    expect(container.querySelector('.review-control-panel')).toHaveTextContent('复盘流程');
    expect(container.querySelector('.review-control-panel')).toHaveTextContent('定位错因');
    expect(container.querySelector('.review-control-panel')).toHaveTextContent('待复盘');
    expect(container.querySelector('.review-control-panel')).toHaveTextContent('清零进度');
    expect(container.querySelector('.review-control-panel')).not.toHaveTextContent('当前重点');
    expect(container.querySelector('.review-control-panel')).not.toHaveTextContent('当前复盘入口');
    expect(container.querySelector('.review-control-panel')).not.toHaveTextContent('当前错题复盘路径');
    expect(container.querySelector('.review-control-panel')).not.toHaveTextContent('当前任务：继续错题复盘');
    expect(screen.getByText('待复盘错题')).toBeInTheDocument();
    expect(screen.getByText('0 道已选')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全选错题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择错题后打印' })).toBeDisabled();
    expect(container.querySelector('.review-mistake-pool')).toHaveTextContent('自由落体运动');
    expect(container.querySelector('.review-mistake-pool')).toHaveTextContent('速度');
    expect(container.querySelector('.review-mistake-group')).toHaveTextContent('1 题');
    expect(container.querySelector('.review-mistake-row')).toHaveTextContent('自由落体的加速度是多少？');
    expect(container.querySelector('.review-mistake-row')).toHaveTextContent('2026/5/16');
    expect(container.querySelector('.review-mistake-row')).toHaveTextContent('打印');
    expect(container.querySelector('.mistake-print-check')).toBeInTheDocument();
    expect(container.querySelector('.review-mistake-row-action')).not.toBeInTheDocument();
    expect(container.querySelector('.review-mistake-row')?.textContent?.trim().startsWith('复盘')).toBe(false);
    expect(container.querySelector('.review-mistake-pool')).toHaveClass('review-scroll-panel');
    expect(container.querySelector('.review-mistake-pool-card')).not.toBeInTheDocument();
    expect(container.querySelector('.review-path-card')).not.toBeInTheDocument();
    expect(container.querySelector('.review-task-card')).not.toBeInTheDocument();
    expect(screen.queryByText('正确答案')).not.toBeInTheDocument();
  });

  it('keeps printing available on the review entrance', async () => {
    apiMocks.getReview.mockResolvedValue(makeReviewData());

    const { container } = renderReview('/review');

    await userEvent.click(await screen.findByRole('button', { name: '全选错题' }));

    expect(screen.getByText('3 道已选')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打印所选错题' })).toBeEnabled();
    const printAnswerImage = container.querySelector('.print-student-answer-image');
    expect(printAnswerImage).toHaveAttribute('src', '/uploads/answer-page-1.png');
  });

  it('redirects the old complete review route back to the review entrance', async () => {
    apiMocks.getReview.mockResolvedValue(makeReviewData());

    renderReview('/review/session');

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent(/^\/review$/);
    });
    expect(await screen.findByRole('heading', { name: '错题本' })).toBeInTheDocument();
    expect(screen.getByText('待复盘错题')).toBeInTheDocument();
  });

  it('opens legacy answer_id links as a single full review page', async () => {
    apiMocks.getReview.mockResolvedValue(makeReviewData());

    const { container } = renderReview('/review?answer_id=33');

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/review/mistake/33');
    });
    expect(await screen.findByRole('heading', { name: '错题复盘' })).toBeInTheDocument();
    expect(container.querySelector('.review-single-toolbar-row')).not.toBeInTheDocument();
    expect(container.querySelector('.review-single-summary-row')).not.toBeInTheDocument();
    expect(container.querySelector('.review-mistake-stem-action')).not.toBeInTheDocument();
    expect(container.querySelector('.review-mistake-completion-action')).not.toBeInTheDocument();
    expect(container.querySelector('.review-variant-floating-action')).toHaveTextContent('变式题');
    expect(screen.queryByText('题目')).not.toBeInTheDocument();
    expect(screen.getAllByText('速度错题')).toHaveLength(1);
    expect(screen.getByText('正确答案')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent(/^\/review$/);
    });
  });

  it('shows the current-question tutor chat in full mistake review', async () => {
    apiMocks.getReview.mockResolvedValue(makeReviewData());

    renderReview('/review/mistake/2');

    expect(await screen.findByTestId('question-tutor-chat')).toHaveTextContent('追问入口 q_model $2g$');
    expect(screen.getByRole('heading', { name: '错题复盘' })).toBeInTheDocument();
  });

  it('keeps the variation action after the review content', async () => {
    apiMocks.getReview.mockResolvedValue(makeReviewData());

    const { container } = renderReview('/review/mistake/33');

    expect(await screen.findByRole('button', { name: '做变式题' })).toBeInTheDocument();
    expect(container.querySelector('.review-single-toolbar-row')).not.toBeInTheDocument();
    expect(container.querySelector('.review-mistake-stem-action')).not.toBeInTheDocument();
    expect(container.querySelector('.review-mistake-completion-action')).not.toBeInTheDocument();
    expect(container.querySelector('.review-variant-floating-action')).toHaveTextContent('变式题');
    expect(screen.queryByText('题目')).not.toBeInTheDocument();
    expect(container.querySelector('.review-mistake-stem-head')).not.toBeInTheDocument();
    expect(container.querySelector('.wrong-question-card > .wrong-question-actions')).not.toBeInTheDocument();
  });

  it('opens wrong-question variation as an independent question session', async () => {
    apiMocks.getReview.mockResolvedValue(makeReviewData());
    apiMocks.getVariations.mockResolvedValue({
      variations: [
        {
          variation_type: 'foundation',
          title: '基础巩固',
          reason: '同一知识点',
          question: { id: 'q_variant_1', stem_text: '第一道变式题', question_type: 'single_choice', options: [] },
        },
        {
          variation_type: 'transfer',
          title: '迁移挑战',
          reason: '相邻模型',
          question: { id: 'q_variant_2', stem_text: '第二道迁移题', question_type: 'single_choice', options: [] },
        },
      ],
    });

    renderReview('/review/mistake/33');

    await userEvent.click(await screen.findByRole('button', { name: '做变式题' }));

    expect(apiMocks.getVariations).toHaveBeenCalledWith(33, 'student-1');
    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/review/mistake/33/variation');
    });
    expect(await screen.findByTestId('review-variant-session')).toHaveTextContent('做变式题');
    expect(screen.getByTestId('review-variant-session')).toHaveTextContent('做对这道变式题即可完成本题复盘。');
    expect(screen.getByTestId('review-variant-session')).toHaveTextContent('q_variant_1 第一道变式题');
    expect(screen.getByTestId('review-variant-progress-nav')).toHaveTextContent('hidden');
    expect(screen.queryByRole('button', { name: '返回错题本' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-variant-question')).not.toBeInTheDocument();
    expect(screen.queryByText('错题复盘')).not.toBeInTheDocument();
    expect(screen.queryByText('迁移挑战')).not.toBeInTheDocument();
    expect(screen.queryByText('第二道迁移题')).not.toBeInTheDocument();
  });

  it('submits the independent variation session through shared single-question grading and then clears the mistake', async () => {
    apiMocks.getReview.mockResolvedValue(makeReviewData());
    apiMocks.getVariations.mockResolvedValue({
      variations: [
        {
          variation_type: 'foundation',
          title: '基础巩固',
          reason: '同一知识点',
          question: { id: 'q_variant_1', stem_text: '第一道变式题', question_type: 'single_choice', options: [] },
        },
      ],
    });
    apiMocks.submitAnswer.mockResolvedValue({
      answer_id: 501,
      is_correct: true,
      correct_answer: 'A',
      explanation: '正确',
      mastery_update: {},
    });
    apiMocks.completeReview.mockResolvedValue({ cleared: true });

    renderReview('/review/mistake/33');

    await userEvent.click(await screen.findByRole('button', { name: '做变式题' }));
    await screen.findByTestId('review-variant-session');
    await userEvent.click(screen.getByRole('button', { name: '提交变式题' }));

    expect(apiMocks.submitAnswer).toHaveBeenCalledWith(
      'student-1',
      expect.objectContaining({
        question_id: 'q_variant_1',
        given_answer: 'A',
      }),
    );
    expect(apiMocks.completeReview).toHaveBeenCalledWith(33);
    await userEvent.click(screen.getByRole('button', { name: '返回错题复盘页' }));
    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/review/mistake/33');
    });
  });

  it('does not expose a separate handwriting submission path for variation practice', async () => {
    apiMocks.getReview.mockResolvedValue(makeReviewData());
    apiMocks.getVariations.mockResolvedValue({
      variations: [
        {
          variation_type: 'foundation',
          title: '基础巩固',
          reason: '同一知识点',
          question: { id: 'q_variant_1', stem_text: '第一道变式题', question_type: 'problem_solving', options: [] },
        },
      ],
    });

    renderReview('/review/mistake/33');

    await userEvent.click(await screen.findByRole('button', { name: '做变式题' }));
    await screen.findByTestId('review-variant-session');

    expect(screen.queryByRole('button', { name: '提交变式手写' })).not.toBeInTheDocument();
  });

  it('uses the shared learning page width for the review notebook workspace', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    const reviewWorkspaceRule = css.match(/\.review-workspace\s*\{[^}]+\}/);

    expect(reviewWorkspaceRule?.[0]).toContain('max-width: var(--learning-page-max-width)');
  });
});
