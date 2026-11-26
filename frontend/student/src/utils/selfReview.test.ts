import { describe, expect, it } from 'vitest';
import type { Question } from '../types';
import { canSelfReviewQuestion } from './selfReview';

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q_self_review_type',
    stem_text: '请作答',
    question_type: 'problem_solving',
    options: [],
    images: [],
    ...overrides,
  };
}

describe('canSelfReviewQuestion', () => {
  it('enables self-review for web fill-in-blank and experiment questions', () => {
    expect(canSelfReviewQuestion(makeQuestion({ question_type: 'fill_in_blank' }))).toBe(true);
    expect(canSelfReviewQuestion(makeQuestion({ question_type: 'knowledge_fill_in_blank' }))).toBe(true);
    expect(canSelfReviewQuestion(makeQuestion({ question_type: 'experiment' }))).toBe(true);
  });

  it('keeps choice questions out of self-review', () => {
    expect(canSelfReviewQuestion(makeQuestion({
      question_type: 'single_choice',
      options: [{ label: 'A', text: '选项 A' }],
    }))).toBe(false);
  });
});
