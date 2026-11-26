import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomeEnergyRings from './HomeEnergyRings';
import { api } from '../api/client';
import type { DailyLearningLoop } from '../types';

vi.mock('../api/client', () => ({
  api: {
    getDailyLearningLoop: vi.fn(),
    getDailyLearningLoopHistory: vi.fn(),
  },
}));

vi.mock('./RewardComponents', () => ({
  DailyLoopHistoryPanel: ({ loading, todayLoop }: { loading: boolean; todayLoop: DailyLearningLoop }) => (
    <div role="region" aria-label="学习日历">
      {loading ? '正在同步历史记录' : `今日 ${todayLoop.rings.practice.actual_current}/${todayLoop.rings.practice.target}`}
    </div>
  ),
}));

const todayLoop: DailyLearningLoop = {
  date: '2026-07-01',
  streak_days: 1,
  is_effective_day: true,
  is_high_quality_day: false,
  rings: {
    practice: {
      key: 'practice',
      label: '做题环',
      completed: false,
      current: 2,
      actual_current: 2,
      target: 5,
      overflow: 0,
      auto_completed: false,
      evidence: '',
    },
    review: {
      key: 'review',
      label: '复盘环',
      completed: false,
      current: 0,
      actual_current: 0,
      target: 3,
      overflow: 0,
      auto_completed: false,
      pending_mistakes: 1,
      evidence: '',
    },
  },
  summary: '',
  next_action: '',
};

describe('HomeEnergyRings', () => {
  beforeEach(() => {
    vi.mocked(api.getDailyLearningLoop).mockReset();
    vi.mocked(api.getDailyLearningLoopHistory).mockReset();
    vi.mocked(api.getDailyLearningLoop).mockResolvedValue(todayLoop);
  });

  it('renders two compact rings with fixed gradients and continuous round masks', () => {
    vi.mocked(api.getDailyLearningLoop).mockReturnValueOnce(new Promise(() => {}));
    const { container } = render(
      <HomeEnergyRings
        newLearnCurrent={5}
        newLearnTarget={3}
        reviewCurrent={2}
        reviewTarget={2}
      />,
    );

    expect(screen.getByRole('button', { name: /展开学习日历/ })).toBeInTheDocument();
    expect(container.querySelectorAll('.home-energy-track')).toHaveLength(2);
    expect(container.querySelectorAll('.home-energy-progress')).toHaveLength(2);
    expect(container.querySelectorAll('.home-energy-overflow')).toHaveLength(1);
    expect(container.querySelectorAll('.home-energy-gradient-segment')).toHaveLength(168);
    expect(container.querySelectorAll('.home-energy-cap')).toHaveLength(0);
    expect(screen.queryByText('学习能量')).not.toBeInTheDocument();
    expect(screen.queryByText('做题环')).not.toBeInTheDocument();
    expect(screen.queryByText('复盘环')).not.toBeInTheDocument();

    const masks = container.querySelectorAll('.home-energy-mask');
    expect(masks).toHaveLength(4);
    expect(masks[0]).toHaveAttribute('pathLength', '1');
    expect(masks[0]).toHaveAttribute('stroke-linecap', 'round');
    expect(masks[0]).toHaveAttribute('style', expect.stringContaining('stroke-dasharray: 1 1'));
    expect(container.querySelector('.home-energy-progress-new-learn')).toHaveAttribute(
      'mask',
      'url(#home-energy-progress-mask-new-learn)',
    );
    expect(container.querySelector('.home-energy-overflow-new-learn')).toHaveAttribute(
      'mask',
      'url(#home-energy-overflow-mask-new-learn)',
    );
  });

  it('labels today\'s goal with the closed rings and both counts', async () => {
    render(<HomeEnergyRings newLearnCurrent={0} newLearnTarget={3} reviewCurrent={0} reviewTarget={1} />);

    expect(await screen.findByText('2/5')).toBeInTheDocument();
    expect(screen.getByText('今日目标')).toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();
    expect(screen.getByText('项达标')).toBeInTheDocument();
    expect(screen.getByText('0/3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /今日目标已完成 0 项，做题 2\/5，复盘 0\/3/ })).toBeInTheDocument();
  });

  it('shows only the neutral tracks when both ring values are zero', () => {
    vi.mocked(api.getDailyLearningLoop).mockRejectedValueOnce(new Error('use fallback'));
    const { container } = render(
      <HomeEnergyRings
        newLearnCurrent={0}
        newLearnTarget={3}
        reviewCurrent={0}
        reviewTarget={1}
      />,
    );

    expect(container.querySelectorAll('.home-energy-track')).toHaveLength(2);
    expect(container.querySelectorAll('.home-energy-progress')).toHaveLength(0);
    expect(container.querySelectorAll('.home-energy-overflow')).toHaveLength(0);
    expect(container.querySelectorAll('.home-energy-cap')).toHaveLength(0);
    container.querySelectorAll('.home-energy-mask').forEach(mask => {
      expect(mask).toHaveAttribute('style', expect.stringContaining('stroke-dasharray: 0 1'));
    });
  });

  it('opens the daily loop history when the compact rings are clicked', async () => {
    vi.mocked(api.getDailyLearningLoopHistory).mockResolvedValue({
      start_date: '2026-07-01',
      end_date: '2026-07-01',
      practice_target: 3,
      review_target: 1,
      summary: {
        practice_total: 1,
        review_total: 0,
        practice_closed_days: 0,
        review_closed_days: 0,
        dual_closed_days: 0,
        effective_days: 1,
      },
      days: [],
    });

    render(
      <HomeEnergyRings
        newLearnCurrent={1}
        newLearnTarget={3}
        reviewCurrent={0}
        reviewTarget={1}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /展开学习日历/ }));

    await waitFor(() => expect(api.getDailyLearningLoopHistory).toHaveBeenCalledWith(undefined, 35));
    expect(await screen.findByRole('region', { name: '学习日历' })).toBeInTheDocument();
    expect(await screen.findByText('今日 2/5')).toBeInTheDocument();
  });
});
