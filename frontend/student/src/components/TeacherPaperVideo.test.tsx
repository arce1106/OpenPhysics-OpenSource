import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import TeacherPaperVideo from './TeacherPaperVideo';

vi.mock('../api/client', () => ({ api: { getQuestionLessonVideo: vi.fn() } }));
const lesson = { id: 'video-1', title: '运动', duration_seconds: 116, available: true };
const videos = [
  { question_id: 'q1', title: '第1题', video_url: '/api/student/question-videos/media?token=one', duration_seconds: 111 },
  { question_id: 'q2', title: '第2题', video_url: '/api/student/question-videos/media?token=two', duration_seconds: 116 },
];

describe('TeacherPaperVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    vi.mocked(api.getQuestionLessonVideo).mockImplementation(async questionId => videos.find(video => video.question_id === questionId)!);
  });

  it('does not expose playback for missing or locked videos', () => {
    const { rerender } = render(<TeacherPaperVideo questionId="q1" answerId={1} />);
    expect(screen.queryByRole('button', { name: '视频讲解' })).not.toBeInTheDocument();
    rerender(<TeacherPaperVideo lesson={{ ...lesson, available: false, locked_reason: '整套批改后开放' }} questionId="q1" answerId={1} />);
    expect(screen.getByText('整套批改后开放')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '视频讲解' })).not.toBeInTheDocument();
    expect(api.getQuestionLessonVideo).not.toHaveBeenCalled();
  });

  it('loads only on demand, selects the current question, and releases the player when closed', async () => {
    const user = userEvent.setup();
    render(<TeacherPaperVideo lesson={lesson} questionId="q2" answerId={2} />);
    expect(api.getQuestionLessonVideo).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '视频讲解' }));
    const player = await screen.findByLabelText('第2题讲解视频');
    expect(player).toHaveAttribute('src', expect.stringContaining('token=two'));
    expect(player).not.toHaveAttribute('autoplay');
    expect(api.getQuestionLessonVideo).toHaveBeenCalledWith('q2', 2);
    await user.click(screen.getByRole('button', { name: '关闭视频，返回题目' }));
    expect(screen.queryByLabelText('第2题讲解视频')).not.toBeInTheDocument();
  });

  it('keeps a denied unlock closed and can retry a failed media request with a fresh URL', async () => {
    vi.mocked(api.getQuestionLessonVideo).mockRejectedValueOnce(new Error('请先完成整套批改'));
    const user = userEvent.setup();
    render(<TeacherPaperVideo lesson={lesson} questionId="q1" answerId={2} />);
    await user.click(screen.getByRole('button', { name: '视频讲解' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请先完成整套批改');
    expect(screen.queryByLabelText('第1题讲解视频')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '视频讲解' }));
    fireEvent.error(await screen.findByLabelText('第1题讲解视频'));
    await user.click(screen.getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(api.getQuestionLessonVideo).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('returns to the same question position when late images shift the answer sheet during playback', async () => {
    const user = userEvent.setup();
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    render(<TeacherPaperVideo lesson={lesson} questionId="q1" answerId={1} />);
    const trigger = screen.getByRole('button', { name: '视频讲解' });
    const rect = vi.spyOn(trigger, 'getBoundingClientRect');
    rect.mockReturnValue({ top: 200 } as DOMRect);
    await user.click(trigger);
    await screen.findByRole('dialog');
    rect.mockReturnValue({ top: 340 } as DOMRect);
    await user.click(screen.getByRole('button', { name: '关闭视频，返回题目' }));
    expect(trigger).toHaveFocus();
    expect(scrollBy).toHaveBeenCalledWith({ top: 140, left: 0, behavior: 'instant' });
    scrollBy.mockRestore();
  });
});
