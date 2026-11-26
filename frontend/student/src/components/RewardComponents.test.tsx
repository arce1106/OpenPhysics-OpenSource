import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { buildGrowthFeedback, GrowthFeedbackPanel, GrowthReportCard } from './RewardComponents';
import { api } from '../api/client';
import type { SubmitResult } from '../types';

vi.mock('../api/client', () => ({
  api: {
    getGrowthReport: vi.fn(),
    generateGrowthReport: vi.fn(),
  },
}));

const mockedApi = api as unknown as {
  getGrowthReport: ReturnType<typeof vi.fn>;
  generateGrowthReport: ReturnType<typeof vi.fn>;
};

const baseResult: SubmitResult = {
  is_correct: true,
  correct_answer: 'A',
  explanation: null,
  mastery_update: {},
};

describe('GrowthFeedbackPanel', () => {
  it('frames a correct answer as learning growth without gamified language', () => {
    render(
      <GrowthFeedbackPanel
        result={{
          ...baseResult,
          mastery_update: {
            k1: { name: '楞次定律', before: 0.52, after: 0.66 },
          },
        }}
      />,
    );

    expect(screen.getByText('学习闭环反馈')).toBeInTheDocument();
    expect(screen.getByText(/楞次定律.*52%.*66%/)).toBeInTheDocument();
    expect(screen.queryByText(/XP|Lv\.|升级|徽章|每日任务|体力/)).not.toBeInTheDocument();
  });

  it('turns process grading into a concrete correction suggestion', () => {
    const feedback = buildGrowthFeedback({
      ...baseResult,
      is_correct: false,
      process_grading: {
        process_score: 68,
        model_correct: true,
        equation_correct: true,
        calculation_correct: false,
        unit_correct: null,
        first_error: '代入数值时漏掉平方',
        next_action: '重新检查公式中的时间平方项',
        error_type: 'calculation',
        error_type_name: '计算处理错误',
      },
    });

    expect(feedback.title).toBe('先修正第一处问题');
    expect(feedback.points.join(' ')).toContain('计算处理错误');
    expect(feedback.nextAction).toContain('时间平方项');
  });
});

describe('GrowthReportCard', () => {
  beforeEach(() => {
    mockedApi.getGrowthReport.mockReset();
    mockedApi.generateGrowthReport.mockReset();
  });

  it('uses the shared homepage action styles for refresh and history', async () => {
    mockedApi.getGrowthReport.mockResolvedValue({
      report: {
        id: 'growth-1',
        summary: '本周完成了 26 道题。',
        metrics: { total_answers: 26 },
        start_date: '2026-07-05',
        end_date: '2026-07-12',
      },
    });

    render(
      <MemoryRouter>
        <GrowthReportCard />
      </MemoryRouter>,
    );

    const refresh = await screen.findByRole('button', { name: '刷新成长回顾' });
    const history = screen.getByRole('link', { name: '查看这 26 题记录' });

    expect(refresh).toHaveClass('growth-report-refresh');
    expect(history).toHaveClass('growth-report-history-link');
    expect(history).toHaveAttribute('href', '/history?from_date=2026-07-05&to_date=2026-07-12&source=growth');
    expect(screen.getByRole('link', { name: '查看历次作业得分' })).toHaveAttribute('href', '/homework');
  });
});
