import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LearnPage from './LearnPage';
import { api } from '../api/client';
import type { DirectoryData, LearnBundle } from '../types';

vi.mock('../api/client', () => ({
  api: {
    getLearnBundle: vi.fn(),
    getDirectory: vi.fn(),
    getLearnVideos: vi.fn(),
    getLearnSimulation: vi.fn(),
  },
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

vi.mock('../components/AITutorChat', () => ({
  default: () => <button type="button">打开AI助教</button>,
}));

vi.mock('../components/VideoRecommendations', () => ({
  default: () => <div>视频推荐</div>,
}));

const learnBundle: LearnBundle = {
  kp_id: 'kp_history',
  kp_name: '楞次定律',
  card: null,
  slides: null,
  simulations: [],
  examples: [],
  progress: {
    card: { consumed: 0, total: 1 },
  },
};

const directory: DirectoryData = {
  kps: [
    {
      id: 'kp_history',
      name: '楞次定律',
      volume: '选择性必修 第二册',
      chapter: '电磁感应',
      section: '楞次定律',
      mastery: 1,
      status: 'mastered',
      learning_state: 'mastered',
      learning_state_label: '已掌握',
      learning_state_tone: 'mastered',
      blocked_by: [],
      last_practiced: null,
    },
  ],
  stats: {
    mastered: 1,
    in_progress: 0,
    locked: 0,
    total: 1,
  },
  relations: [],
};

describe('LearnPage navigation', () => {
  beforeEach(() => {
    vi.mocked(api.getLearnBundle).mockResolvedValue(learnBundle);
    vi.mocked(api.getDirectory).mockResolvedValue(directory);
    vi.mocked(api.getLearnVideos).mockResolvedValue({
      kp_id: 'kp_history',
      kp_name: '楞次定律',
      query: '',
      items: [],
      fallback: false,
    });
    vi.mocked(api.getLearnSimulation).mockResolvedValue({
      kp_id: 'kp_history',
      kp_name: '楞次定律',
      simulation: null,
    });
  });

  it('uses the saved return target before falling back to the browser history stack', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/previous',
          {
            pathname: '/learn',
            search: '?kp=kp_history',
            state: { from: '/sync', restoreKpId: 'kp_history' },
          },
        ]}
        initialIndex={1}
      >
        <Routes>
          <Route path="/previous" element={<div data-testid="previous-page">上一页</div>} />
          <Route path="/sync" element={<div data-testid="sync-page">同步学习</div>} />
          <Route path="/learn" element={<LearnPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('楞次定律');
    await userEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(screen.getByTestId('sync-page')).toBeInTheDocument();
    expect(screen.queryByTestId('previous-page')).not.toBeInTheDocument();
  });

  it('keeps learning resources focused without the old bottom mastery CTA', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/learn?kp=kp_history']}>
        <Routes>
          <Route path="/learn" element={<LearnPage />} />
          <Route
            path="/learn/check"
            element={<div data-testid="practice-page">巩固小练</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('楞次定律');
    expect(container.querySelector('.learn-header-panel .learn-progress-panel')).toBeInTheDocument();
    expect(container.querySelector(':scope > .learn-progress-panel')).not.toBeInTheDocument();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.queryByText('卡片: 0/1')).not.toBeInTheDocument();
    expect(screen.queryByText('学习路径')).not.toBeInTheDocument();
    expect(screen.queryByText('学习资源')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '问 AI' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开AI助教' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '讲解' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '去巩固提升' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '学完后做掌握评估' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始掌握评估' })).not.toBeInTheDocument();
    expect(screen.queryByText('知识小测')).not.toBeInTheDocument();
  });
});
