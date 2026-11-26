import { describe, expect, it } from 'vitest';
import { buildGrowthReportHistoryPath, buildReviewMistakePath, filterHistoryRecords, getGrowthReportAnswerCount } from './historyRecords';
import type { AnswerHistoryItem, GrowthReportData } from '../types';

describe('historyRecords', () => {
  it('builds a growth-report scoped history link', () => {
    const report: GrowthReportData = {
      id: 'r1',
      summary: '本周你完成了 22 道题。',
      metrics: { total_answers: 22 },
      start_date: '2026-05-09',
      end_date: '2026-05-15',
    };

    expect(getGrowthReportAnswerCount(report)).toBe(22);
    expect(buildGrowthReportHistoryPath(report)).toBe('/history?from_date=2026-05-09&to_date=2026-05-15&source=growth');
  });

  it('builds a precise wrong-notebook link for one answer record', () => {
    expect(buildReviewMistakePath(277)).toBe('/review?answer_id=277');
  });

  it('filters history records by learning result', () => {
    const records = [
      { id: 1, question_id: 'q1', given_answer: 'A', is_correct: true, time_spent_ms: 1, created_at: '2026-05-15' },
      { id: 2, question_id: 'q2', given_answer: 'B', is_correct: false, time_spent_ms: 1, created_at: '2026-05-15' },
      {
        id: 3,
        question_id: 'q3',
        given_answer: '过程',
        is_correct: false,
        time_spent_ms: 1,
        created_at: '2026-05-15',
        process_grading: { needs_human_review: true },
      },
    ] satisfies AnswerHistoryItem[];

    expect(filterHistoryRecords(records, 'correct').map(record => record.id)).toEqual([1]);
    expect(filterHistoryRecords(records, 'wrong').map(record => record.id)).toEqual([2, 3]);
    expect(filterHistoryRecords(records, 'review').map(record => record.id)).toEqual([3]);
  });
});
