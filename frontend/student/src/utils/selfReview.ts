import type { Question } from '../types';

export type SelfReviewStatus = 'correct' | 'partial' | 'wrong';

export interface SelfReviewItem {
  label: string;
  status: SelfReviewStatus | null;
}

export interface SelfReviewDraft {
  items: Array<{ label: string; status: SelfReviewStatus }>;
  time_spent_ms: number;
}

export const SELF_REVIEW_TYPES = new Set([
  'problem_solving',
  'comprehensive',
  'experiment',
  'graph_construction',
  'fill_in_blank',
  'knowledge_fill_in_blank',
]);

function normalizedQuestionType(question: Question) {
  return question.question_type || '';
}

export function canSelfReviewQuestion(question: Question) {
  const type = normalizedQuestionType(question);
  return SELF_REVIEW_TYPES.has(type);
}

export function buildSelfReviewItems(question: Question, answer?: string | null): SelfReviewItem[] {
  const source = `${answer || ''}\n${question.stem_text || ''}`;
  const labels = Array.from(source.matchAll(/\(\s*\d+\s*\)/g))
    .map(match => match[0].replace(/\s+/g, ''));
  const uniqueLabels = Array.from(new Set(labels));
  if (uniqueLabels.length > 0) {
    return uniqueLabels.map(label => ({ label, status: null }));
  }
  return [{ label: '整题', status: null }];
}
