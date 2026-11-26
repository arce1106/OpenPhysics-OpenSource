import type { AnswerHistoryItem, GrowthReportData } from '../types';

export type HistoryResultFilter = 'all' | 'correct' | 'wrong' | 'review';

export function getGrowthReportAnswerCount(report: GrowthReportData | null): number {
  const raw = report?.metrics?.total_answers;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export function buildGrowthReportHistoryPath(report: GrowthReportData): string {
  const params = new URLSearchParams();
  if (report.start_date) params.set('from_date', report.start_date);
  if (report.end_date) params.set('to_date', report.end_date);
  params.set('source', 'growth');
  const query = params.toString();
  return query ? `/history?${query}` : '/history';
}

export function buildReviewMistakePath(answerId: number): string {
  return `/review?answer_id=${encodeURIComponent(String(answerId))}`;
}

export function filterHistoryRecords(
  records: AnswerHistoryItem[],
  resultFilter: HistoryResultFilter,
): AnswerHistoryItem[] {
  if (resultFilter === 'correct') return records.filter(record => record.is_correct);
  if (resultFilter === 'wrong') return records.filter(record => !record.is_correct);
  if (resultFilter === 'review') {
    return records.filter(record => record.process_grading?.needs_human_review);
  }
  return records;
}
