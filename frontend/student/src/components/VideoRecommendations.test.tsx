import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VideoRecommendations from './VideoRecommendations';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    getLearnVideos: vi.fn(),
  },
}));

describe('VideoRecommendations', () => {
  beforeEach(() => {
    vi.mocked(api.getLearnVideos).mockReset();
  });

  it('shows the experiment card as a concise video card', async () => {
    vi.mocked(api.getLearnVideos).mockResolvedValue({
      kp_id: 'v1c2s4k01',
      kp_name: '自由落体运动',
      query: '高一物理 自由落体',
      fallback: true,
      items: [
        {
          id: 'main-video',
          title: '知识点讲解',
          url: 'https://www.bilibili.com/video/BVMAIN/',
          uploader: '北大学长跳跳',
          duration: '08:00',
          source: 'teacher_curated',
          category: '最相关讲解',
          reason: '讲解说明',
          match_focus: '自由落体',
        },
      ],
      experiment: {
        id: 'experiment-video',
        title: '自由落体实验',
        url: 'https://www.bilibili.com/video/BVEXP/',
        uploader: '高考物理林老师',
        duration: '02:18',
        source: 'teacher_experiment_curated',
        category: '演示实验',
        play_count: 31944,
        reason: '用实验现象帮助学生理解自由落体。',
        match_focus: '自由落体运动',
      },
    });

    render(<VideoRecommendations kpId="v1c2s4k01" />);

    expect(await screen.findByText('自由落体实验')).toBeInTheDocument();
    expect(screen.getByText('高考物理林老师 · 02:18')).toBeInTheDocument();
    expect(screen.queryByText(/31944播放/)).not.toBeInTheDocument();
    expect(screen.queryByText('用实验现象帮助学生理解自由落体。')).not.toBeInTheDocument();

    await waitFor(() => expect(api.getLearnVideos).toHaveBeenCalledWith('v1c2s4k01'));
  });

  it('shows multiple teacher curated experiment cards when present', async () => {
    vi.mocked(api.getLearnVideos).mockResolvedValue({
      kp_id: 'x2c2s1k04',
      kp_name: '楞次定律表述',
      query: '楞次定律',
      fallback: true,
      items: [],
      experiment: {
        id: 'experiment-video-1',
        title: '楞次定律实验探究',
        url: 'https://www.bilibili.com/video/BVEXP1/',
        uploader: '高考物理林老师',
        source: 'teacher_experiment_curated',
        category: '演示实验',
        reason: '实验一',
        match_focus: '楞次定律',
      },
      experiments: [
        {
          id: 'experiment-video-1',
          title: '楞次定律实验探究',
          url: 'https://www.bilibili.com/video/BVEXP1/',
          uploader: '高考物理林老师',
          source: 'teacher_experiment_curated',
          category: '演示实验',
          reason: '实验一',
          match_focus: '楞次定律',
        },
        {
          id: 'experiment-video-2',
          title: '探究感应电流方向',
          url: 'https://www.bilibili.com/video/BVEXP2/',
          uploader: '高考物理林老师',
          source: 'teacher_experiment_curated',
          category: '演示实验',
          reason: '实验二',
          match_focus: '楞次定律',
        },
      ],
    });

    render(<VideoRecommendations kpId="x2c2s1k04" />);

    expect(await screen.findByText('楞次定律实验探究')).toBeInTheDocument();
    expect(screen.getByText('探究感应电流方向')).toBeInTheDocument();
  });
});
