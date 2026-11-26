import { describe, expect, it } from 'vitest';
import { buildPracticeSummary } from './practiceSummary';
import type { SubmitResult } from '../types';

function result(overrides: Partial<SubmitResult>): SubmitResult {
  return {
    is_correct: true,
    correct_answer: 'A',
    explanation: null,
    mastery_update: {},
    ...overrides,
  };
}

describe('buildPracticeSummary', () => {
  it('summarizes correctness and mastery changes across a session', () => {
    const summary = buildPracticeSummary({
      q1: result({
        is_correct: true,
        mastery_update: {
          k1: { name: '速度与时间的关系', before: 0.42, after: 0.56 },
        },
      }),
      q2: result({
        is_correct: false,
        mastery_update: {
          k1: { name: '速度与时间的关系', before: 0.56, after: 0.5 },
          k2: { name: '速度与位移的关系', before: 0.3, after: 0.28 },
        },
      }),
    });

    expect(summary.correctCount).toBe(1);
    expect(summary.totalCount).toBe(2);
    expect(summary.accuracy).toBe(0.5);
    expect(summary.masteryChanges[0]).toMatchObject({
      kpId: 'k1',
      name: '速度与时间的关系',
      before: 0.42,
      after: 0.5,
    });
    expect(summary.weakMasteryChanges.map(item => item.kpId)).toEqual(['k2']);
  });

  it('recommends review first when any answer is wrong', () => {
    const summary = buildPracticeSummary({
      q1: result({ is_correct: true }),
      q2: result({ is_correct: false }),
    });

    expect(summary.nextStep.kind).toBe('review');
    expect(summary.nextStep.label).toBe('去清除错题');
  });

  it('uses process scores for non-choice partial-credit summaries', () => {
    const summary = buildPracticeSummary({
      q1: result({ is_correct: true }),
      q2: result({
        is_correct: false,
        process_grading: { process_score: 60 },
      }),
    });

    expect(summary.correctCount).toBe(1.6);
    expect(summary.totalCount).toBe(2);
    expect(summary.accuracy).toBe(0.8);
  });

  it('recommends continuing when all answers are correct', () => {
    const summary = buildPracticeSummary({
      q1: result({ is_correct: true }),
      q2: result({ is_correct: true }),
    });

    expect(summary.nextStep.kind).toBe('continue');
    expect(summary.headline).toContain('本轮方法比较稳定');
  });
});
