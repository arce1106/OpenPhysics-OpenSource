import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from './HomePage';
import { api } from '../api/client';
import type { DashboardData, StudentProfile } from '../types';

const authState = vi.hoisted(() => ({
  profile: {
    id: 'student-1',
    username: 'student',
    display_name: '学生',
    status: 'active',


  } as StudentProfile,
}));

vi.mock('../api/client', () => ({
  api: {
    getDashboard: vi.fn(),
    getDailyLearningLoop: vi.fn(),
    getDailyLearningLoopHistory: vi.fn(),
    prefetchDirectory: vi.fn(),
    listTeacherHomework: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'student-1',
  getStudentProfile: () => authState.profile,
}));

vi.mock('../components/RewardComponents', () => ({
  DailyLoopHistoryPanel: () => <div>学习日历</div>,
  GrowthReportCard: () => <div>成长回顾</div>,
  GrowthStatusBadge: () => <div>学习成长记录</div>,
}));

const dashboard: DashboardData = {
  diagnosis: {
    overall_mastery: 0.42,
    mastered_count: 5,
    in_progress_count: 3,
    locked_count: 10,
    weak_points: [{ kp_id: 'kp-weak', kp_name: '速度与时间关系', mastery: 0.35 }],
  },
  plan: {
    kp_id: 'kp-next',
    kp_name: '匀变速直线运动',
    mastery: 0.2,
    reason: '当前最需要同步学习',
    estimated_questions: 3,
    estimated_minutes: 10,
  },
  motivation: {
    streak_days: 2,
    weekly_kps_mastered: 1,
    mistake_backlog_count: 0,
    next_milestone: '完成本节知识点',
  },
  knowledge_map: [],
};

describe('HomePage', () => {
  beforeEach(() => {
    delete window.Capacitor;
    authState.profile = {
      id: 'student-1',
      username: 'student',
      display_name: '学生',
      status: 'active',


    } as StudentProfile;
    vi.mocked(api.getDashboard).mockResolvedValue(dashboard);
    vi.mocked(api.getDailyLearningLoop).mockRejectedValue(new Error('loop unavailable in page test'));
    vi.mocked(api.getDailyLearningLoopHistory).mockResolvedValue({
      start_date: '2026-07-01',
      end_date: '2026-07-01',
      practice_target: 3,
      review_target: 1,
      summary: {
        practice_total: 0,
        review_total: 0,
        practice_closed_days: 0,
        review_closed_days: 0,
        dual_closed_days: 0,
        effective_days: 0,
      },
      days: [],
    });
    vi.mocked(api.prefetchDirectory).mockClear();
  });

  it('focuses the home page on today action', async () => {
    const { container } = render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('今天怎么学')).toBeInTheDocument();
    expect(screen.getByText('推进「匀变速直线运动」')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /展开学习日历/ })).toBeInTheDocument();
    expect(screen.getByText('下一步建议')).toBeInTheDocument();
    expect(screen.getByText('成长回顾')).toBeInTheDocument();
    expect(screen.queryByText('学习闭环要短，反馈要及时')).not.toBeInTheDocument();
    expect(screen.getByText('下一目标')).toBeInTheDocument();
    expect(screen.getByText('完成本节知识点')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '下载安卓应用' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '学习成长记录' })).toBeInTheDocument();
    expect(container.querySelectorAll('.home-growth-card')).toHaveLength(1);
    expect(container.querySelectorAll('.home-growth-grid > .op-card')).toHaveLength(0);
    expect(screen.queryByText('学习节奏')).not.toBeInTheDocument();
    expect(screen.queryByText('本周推进')).not.toBeInTheDocument();
    expect(screen.queryByText('优先处理')).not.toBeInTheDocument();
    // The top navigation already lists every learning entry.
    expect(container.querySelector('.home-entry-section')).toBeNull();
    expect(screen.queryByText('高考复习')).not.toBeInTheDocument();
  });

  it('prefetches sync directory data after the home dashboard settles', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('今天怎么学')).toBeInTheDocument();
    expect(api.prefetchDirectory).toHaveBeenCalledWith('student-1');
  });

});
