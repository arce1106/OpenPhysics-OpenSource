import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { LearningResourceReport, QualityReport, TeachingInsights } from '../types';
import AdminHomePage from './AdminHomePage';

describe('AdminHomePage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows a dash, not zero, for a report that failed while the others still load', async () => {
    vi.spyOn(api, 'getQualityReport').mockRejectedValue(new Error('超时'));
    vi.spyOn(api, 'getLearningResources').mockResolvedValue({
      summary: { missing_card_count: 1, missing_video_count: 2, missing_simulation_count: 3 },
    } as unknown as LearningResourceReport);
    vi.spyOn(api, 'getTeachingInsights').mockResolvedValue({
      summary: { suspect_questions: 9, weak_point_count: 4 },
    } as unknown as TeachingInsights);

    render(<MemoryRouter><AdminHomePage kps={[]} /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('题库质量：超时');
    expect(screen.getByTestId('question-count')).toHaveTextContent('—');
    // Each to-do card leads to the page where it is handled.
    expect(screen.getByRole('link', { name: /错误率异常的题/ })).toHaveAttribute('href', '/teaching');
    expect(screen.getAllByText('6').length).toBeGreaterThan(0);
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('uses the full issue count instead of the capped list length', async () => {
    vi.spyOn(api, 'getQualityReport').mockResolvedValue({
      summary: {
        question_count: 200, approved_count: 200, pending_count: 0, draft_count: 0, retired_count: 0,
        label_complete_count: 200, label_complete_rate: 1, health_score: 100, issue_question_count: 120,
      },
      issue_questions: new Array(80).fill(null),
    } as unknown as QualityReport);
    vi.spyOn(api, 'getLearningResources').mockRejectedValue(new Error('x'));
    vi.spyOn(api, 'getTeachingInsights').mockRejectedValue(new Error('y'));

    render(<MemoryRouter><AdminHomePage kps={[]} /></MemoryRouter>);

    expect(await screen.findByText('120')).toBeInTheDocument();
  });
});
