import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { QualityReport } from '../types';
import QualityPage from './QualityPage';

const REPORT: QualityReport = {
  summary: { question_count: 10, approved_count: 10, pending_count: 0, draft_count: 0, retired_count: 0,
    label_complete_count: 10, label_complete_rate: 1, health_score: 100 },
  label_coverage: {}, issue_counts: {}, issue_questions: [], chapter_coverage: [], kp_coverage: [], model_coverage: [],
  error_audit: { error_counts: [], samples: [] },
  grading_metrics: {
    window_days: 30, ai_graded_count: 40, correction_count: 2, correction_rate: 0.05,
    needs_review_count: 6, needs_review_rate: 0.15, process_conflict_count: 1,
    photo_item_count: 20, unrecognized_count: 1, unrecognized_rate: 0.05, no_answer_key_count: 0,
    ai_task_count: 50, ai_failure_count: 2, ai_failure_rate: 0.04,
    teacher_review_count: 10, teacher_change_count: 3, teacher_change_rate: 0.3,
    by_model: [
      { model: 'deepseek-flash', ai_graded_count: 30, needs_review_rate: 0.1, correction_rate: 0.03,
        teacher_review_count: 8, teacher_change_rate: 0.25 },
      { model: 'doubao-seed', ai_graded_count: 10, needs_review_rate: 0.3, correction_rate: null,
        teacher_review_count: 0, teacher_change_rate: null },
    ],
  },
};

describe('QualityPage grading metrics', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('compares graders on failure, review and teacher-change rates', async () => {
    vi.spyOn(api, 'getQualityReport').mockResolvedValue(REPORT);
    render(<MemoryRouter><QualityPage kps={[]} selectedVolumeKey={null} selectedKpId={null} selectedChapterKey={null}
      selectedSectionKey={null} allQuestionsId="all" /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: '批改质量' }));

    expect(screen.getByText('批改失败率')).toBeInTheDocument();
    expect(screen.getByText('两个模型都没批完 2 / 批改请求 50')).toBeInTheDocument();
    expect(screen.getByText('老师改了 AI 分数 3 / 老师确认 10')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: '按批改模型' });
    const deepseek = within(table).getByText('deepseek-flash').closest('tr')!;
    expect(deepseek).toHaveTextContent('30');
    // A rate with nothing to divide by shows a dash, not 0%.
    expect(within(table).getByText('doubao-seed').closest('tr')).toHaveTextContent('—');
  });
});
