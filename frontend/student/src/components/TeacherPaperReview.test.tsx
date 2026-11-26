import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { Question, SubmitResult } from '../types';
import TeacherPaperReview from './TeacherPaperReview';

vi.mock('../api/client', () => ({ api: {
  getQuestionLessonVideo: vi.fn(), questionTutorChat: vi.fn(),
} }));

const questions: Question[] = Array.from({ length: 10 }, (_, i) => ({
  id: `q-${i + 1}`, stem_text: `套卷题目内容 ${i + 1}`,
  question_type: i < 6 ? 'single_choice' : i < 8 ? 'experiment' : 'problem_solving',
  options: i < 6 ? [{ label: 'A', text: '答案甲' }, { label: 'B', text: '答案乙' }] : [],
}));
const answers: Record<string, SubmitResult> = Object.fromEntries(questions.map((q, i) => [q.id, {
  answer_id: i + 101, is_correct: i === 0, correct_answer: 'A',
  extracted_answer: i === 0 ? 'A' : 'B', explanation: `题目解析 ${i + 1}`, mastery_update: {},
  lesson_video: { id: `v-${i + 1}`, title: `第 ${i + 1} 题讲解`, available: true, duration_seconds: 60 },
}]));
const props = { title: '运动描述套卷', questions, answers, videoEnabled: true,
  onAnswered: vi.fn(), onBack: vi.fn(), onRestart: vi.fn() };

describe('TeacherPaperReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  it('shows a homework score with what it rests on, and no score for other papers', () => {
    const { rerender } = render(<TeacherPaperReview {...props} />);
    expect(screen.queryByText(/得分/)).not.toBeInTheDocument();
    rerender(<TeacherPaperReview {...props} score={{ percent: 85, label: '85 分', note: 'AI 批改，老师审核后可能调整' }} />);
    expect(screen.getByText('得分 85/100')).toBeInTheDocument();
    expect(screen.getByText('AI 批改，老师审核后可能调整')).toBeInTheDocument();
  });

  it('shows all ten read-only questions in order with independent grading, videos and inline AI', async () => {
    const user = userEvent.setup();
    const { container } = render(<TeacherPaperReview {...props} />);
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(10);
    articles.forEach((article, i) => {
      expect(article).toHaveAccessibleName(`第 ${i + 1} 题`);
      expect(article).toHaveTextContent(`套卷题目内容 ${i + 1}`);
      expect(article).toHaveTextContent(`题目解析 ${i + 1}`);
      expect(within(article).getByRole('button', { name: '视频讲解' })).toBeInTheDocument();
    });
    expect(container.querySelector('.question-tutor-assistant')).toBeNull();
    expect(screen.queryByRole('button', { name: '提交答案' })).not.toBeInTheDocument();
    expect(api.getQuestionLessonVideo).not.toHaveBeenCalled();
    expect(api.questionTutorChat).not.toHaveBeenCalled();
    expect(container.querySelector('video')).toBeNull();
    const second = within(articles[1]);
    const detail = second.getByRole('button', { name: '查看详细批改' });
    expect(detail.parentElement).toContainElement(second.getByRole('button', { name: '视频讲解' }));
    await user.click(detail);
    expect(second.getByRole('button', { name: '收起详细批改' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(articles[9]).getByRole('button', { name: '查看详细批改' })).toHaveAttribute('aria-expanded', 'false');

    vi.mocked(api.getQuestionLessonVideo).mockResolvedValue({ question_id: 'q-10', title: '第 10 题讲解', duration_seconds: 60, video_url: '/video-ten.mp4' });
    await user.click(within(articles[9]).getByRole('button', { name: '视频讲解' }));
    expect(api.getQuestionLessonVideo).toHaveBeenCalledWith('q-10', 110);
    expect(await screen.findByRole('dialog', { name: '第 10 题讲解' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭视频，返回题目' }));
    expect(screen.getAllByRole('article')).toHaveLength(10);

    vi.mocked(api.questionTutorChat).mockResolvedValue({ text: '请先分析受力。' });
    await user.click(second.getByRole('button', { name: '打开AI助教' }));
    await user.type(screen.getByRole('textbox', { name: '输入对这道题的追问' }), '为什么选 A？');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(api.questionTutorChat).toHaveBeenCalledWith(expect.objectContaining({ question_id: 'q-2', given_answer: 'B', message: '为什么选 A？' }));
    await user.click(screen.getByRole('button', { name: '关闭AI助教' }));
    expect(props.onAnswered).not.toHaveBeenCalled();
  });

  it('keeps unavailable or absent videos closed within the full answer sheet', () => {
    render(<TeacherPaperReview {...props} answers={{ ...answers,
      'q-1': { ...answers['q-1'], lesson_video: null },
      'q-2': { ...answers['q-2'], lesson_video: { ...answers['q-2'].lesson_video!, available: false, locked_reason: '整套批改后开放' } },
    }} />);
    expect(within(screen.getByRole('article', { name: '第 1 题' })).queryByRole('button', { name: '视频讲解' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: '第 2 题' })).toHaveTextContent('整套批改后开放');
    expect(api.getQuestionLessonVideo).not.toHaveBeenCalled();
  });
});
