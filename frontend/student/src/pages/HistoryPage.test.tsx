import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HistoryPage from './HistoryPage';
import type { AnswerHistoryItem } from '../types';

const apiMocks = vi.hoisted(() => ({
  getAnswerHistory: vi.fn(),
  getQuestionLessonVideo: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: apiMocks,
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentProfile: () => ({
    id: 'student-1',
    username: 'student',
    display_name: '学生',
    status: 'active',


  }),
}));

function renderHistoryPage() {
  return render(
    <MemoryRouter initialEntries={['/history']}>
      <Routes>
        <Route path="/history" element={<HistoryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function makeRecord(overrides: Partial<AnswerHistoryItem> = {}): AnswerHistoryItem {
  return {
    id: 1,
    question_id: 'q-history',
    stem_text: '历史题干 $v=at$',
    question_type: 'single_choice',
    options: [
      { label: 'A', text: '速度增大' },
      { label: 'B', text: '速度不变' },
    ],
    images: [],
    given_answer: 'A',
    is_correct: false,
    correct_answer: 'A',
    explanation: '解析文本',
    process_grading: null,
    reviewed_at: null,
    time_spent_ms: null,
    created_at: '2026-07-06T00:00:00Z',
    ...overrides,
  };
}

describe('HistoryPage', () => {
  beforeEach(() => {
    apiMocks.getAnswerHistory.mockReset();
  });

  it('marks videos and opens the explanation for the exact history answer, including correct answers', async () => {
    apiMocks.getAnswerHistory.mockResolvedValue([makeRecord({ is_correct: true,
      lesson_video: { id: 'lesson', title: '历史题讲解', available: true, duration_seconds: 60 } })]);
    apiMocks.getQuestionLessonVideo.mockResolvedValue({ question_id: 'q-history', title: '历史题', video_url: '/media/signed', duration_seconds: 60 });
    renderHistoryPage();
    expect(await screen.findByText('有视频讲解')).toBeInTheDocument();
    expect(screen.getByText('视频讲解', { selector: 'button' }).closest('.grading-trust-head')).not.toBeNull();
    expect(screen.queryByText('可信度中')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('视频讲解'));
    expect(await screen.findByLabelText('历史题讲解视频')).toHaveAttribute('src', expect.stringContaining('/media/signed'));
    expect(apiMocks.getQuestionLessonVideo).toHaveBeenCalledWith('q-history', 1);
  });

  it('renders expanded history questions through the shared question display surface', async () => {
    apiMocks.getAnswerHistory.mockResolvedValue([makeRecord()]);

    const { container } = renderHistoryPage();

    const surface = await waitFor(() => {
      const node = container.querySelector('.question-display-surface');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });

    expect(within(surface).getByText(/历史题干/)).toBeInTheDocument();
    expect(within(surface).getByText('A')).toBeInTheDocument();
    expect(within(surface).getByText('B')).toBeInTheDocument();
    expect(screen.queryByText('提交答案')).not.toBeInTheDocument();
  });

  it('places the lesson video on the human-review heading row after the answer comparison', async () => {
    apiMocks.getAnswerHistory.mockResolvedValue([makeRecord({
      process_grading: { confidence_level: 'low', grading_confidence: 0.4, needs_human_review: true, grading_basis: '需要核对过程' },
      lesson_video: { id: 'lesson', title: '历史题讲解', available: true, duration_seconds: 60 },
    })]);
    renderHistoryPage();
    const badge = await screen.findByText('建议人工确认 40%');
    const heading = badge.closest('.grading-trust-head') as HTMLElement;
    const video = within(heading).getByRole('button', { name: '视频讲解' });
    expect(video.parentElement).toHaveClass('grading-trust-actions');
    expect(heading.lastElementChild).toBe(video.parentElement);
    expect(screen.getByText('我的答案').compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText('视频讲解', { selector: 'button' })).toHaveLength(1);
  });
});
