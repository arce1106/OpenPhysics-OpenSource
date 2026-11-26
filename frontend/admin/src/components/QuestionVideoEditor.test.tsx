import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../api/client';
import type { QuestionVideo } from '../types';
import QuestionVideoEditor from './QuestionVideoEditor';
import WorkspacePage from './WorkspacePage';

vi.mock('../api/client', () => ({ api: {
  uploadQuestionVideo: vi.fn(), reviewQuestionVideo: vi.fn(), previewQuestionVideo: vi.fn(),
  listQuestionsPaged: vi.fn(),
} }));

const draft: QuestionVideo = { id: 'video-1', question_id: 'q-1', title: '本题视频讲解', duration_seconds: 95, status: 'draft' };

beforeEach(() => vi.clearAllMocks());

it('uploads a draft, previews only when requested, and publishes the question video', async () => {
  vi.mocked(api.uploadQuestionVideo).mockResolvedValue(draft);
  vi.mocked(api.previewQuestionVideo).mockResolvedValue({ video_url: '/api/student/question-videos/media?token=preview' });
  vi.mocked(api.reviewQuestionVideo).mockResolvedValue({ ...draft, status: 'approved' });
  function Host() {
    const [video, setVideo] = useState<QuestionVideo | null>(null);
    return <QuestionVideoEditor questionId="q-1" video={video} onChange={setVideo} />;
  }
  const { container } = render(<Host />);
  expect(screen.queryByText('有视频讲解')).not.toBeInTheDocument();
  const file = new File(['video'], '第01题.mp4', { type: 'video/mp4' });
  fireEvent.change(screen.getByLabelText('选择视频'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: '上传视频' }));
  await screen.findByText('视频待发布');
  expect(api.uploadQuestionVideo).toHaveBeenCalledWith('q-1', file, '本题视频讲解');
  expect(api.previewQuestionVideo).not.toHaveBeenCalled();
  expect(container.querySelector('video')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '预览视频' }));
  await waitFor(() => expect(container.querySelector('video')).not.toBeNull());
  expect(container.querySelector('video')).not.toHaveAttribute('autoplay');
  fireEvent.click(screen.getByRole('button', { name: '审核通过并发布' }));
  await screen.findByText('有视频讲解');
  expect(api.reviewQuestionVideo).toHaveBeenCalledWith('q-1', 'approved');
  fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
  expect(container.querySelector('video')).toBeNull();
});

it('retains the existing video and gives a retryable error when upload validation fails', async () => {
  vi.mocked(api.uploadQuestionVideo).mockRejectedValue(new Error('视频无法读取，请重新导出 MP4 后上传'));
  const onChange = vi.fn();
  render(<QuestionVideoEditor questionId="q-1" video={{ ...draft, status: 'approved' }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('选择替换视频'), { target: { files: [new File(['bad'], 'fake.mp4')] } });
  fireEvent.click(screen.getByRole('button', { name: '上传替换视频' }));
  await screen.findByRole('alert');
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText('有视频讲解')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '上传替换视频' })).toBeEnabled();
});

it('filters the question bank by published video availability through server pagination', async () => {
  vi.mocked(api.listQuestionsPaged).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 });
  render(<MemoryRouter><WorkspacePage kps={[]} selectedVolumeKey={null} selectedKpId="all" selectedChapterKey={null}
    selectedSectionKey={null} allQuestionsId="all" /></MemoryRouter>);
  await waitFor(() => expect(api.listQuestionsPaged).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('视频讲解筛选'), { target: { value: 'true' } });
  await waitFor(() => expect(api.listQuestionsPaged).toHaveBeenLastCalledWith(expect.objectContaining({ has_video: 'true', page: '1' })));
  fireEvent.change(screen.getByLabelText('视频讲解筛选'), { target: { value: 'false' } });
  await waitFor(() => expect(api.listQuestionsPaged).toHaveBeenLastCalledWith(expect.objectContaining({ has_video: 'false', page: '1' })));
});
