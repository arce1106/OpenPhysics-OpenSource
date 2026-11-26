import { describe, expect, it } from 'vitest';
import type { KnowledgeMasteryJudgment } from '../types';
import {
  getKnowledgeMasteryDisplayText,
  getKnowledgeMasteryPrimaryLabel,
  getKnowledgeMasteryPriority,
  getRetestJudgmentLabel,
  getTrainJudgmentActionHint,
  getTrainJudgmentSummaryText,
  shouldJudgmentOverrideRecommendation,
  summarizeKnowledgeMasteryJudgments,
} from './knowledgeMasteryJudgment';

function judgment(overrides: Partial<KnowledgeMasteryJudgment>): KnowledgeMasteryJudgment {
  return {
    kpId: 'kp-1',
    kpName: '质点',
    masteryScore: 0.2,
    masteryLevel: 'weak',
    interventionStatus: 'needs_learning',
    confidence: 'high',
    nextAction: 'learn',
    reason: '当前基础证据较弱，建议先学习知识点讲解。',
    evidenceSources: [],
    evidences: [],
    recentCorrectCount: 0,
    recentTotalCount: 0,
    ...overrides,
  };
}

describe('knowledge mastery judgment display helpers', () => {
  it('maps mastery levels to student-facing Chinese labels', () => {
    expect(getKnowledgeMasteryDisplayText('weak')).toBe('薄弱');
    expect(getKnowledgeMasteryDisplayText('developing')).toBe('发展中');
    expect(getKnowledgeMasteryDisplayText('stable')).toBe('较稳定');
    expect(getKnowledgeMasteryDisplayText('mastered')).toBe('已掌握');
  });

  it('prioritizes low confidence and closed-loop intervention states over recommendation labels', () => {
    const lowConfidence = judgment({
      confidence: 'low',
      masteryLevel: 'weak',
      interventionStatus: 'needs_learning',
    });
    const awaitingRetest = judgment({
      confidence: 'high',
      masteryLevel: 'stable',
      interventionStatus: 'awaiting_retest',
    });
    const inImprovement = judgment({
      confidence: 'high',
      masteryLevel: 'developing',
      interventionStatus: 'in_improvement',
    });
    const passedRecently = judgment({
      confidence: 'high',
      masteryLevel: 'mastered',
      interventionStatus: 'passed_recently',
    });
    const weakRecommended = judgment({
      confidence: 'high',
      masteryLevel: 'weak',
      interventionStatus: 'needs_practice',
    });

    expect(getKnowledgeMasteryPriority(lowConfidence)).toBeGreaterThan(getKnowledgeMasteryPriority(awaitingRetest));
    expect(shouldJudgmentOverrideRecommendation(awaitingRetest)).toBe(true);
    expect(shouldJudgmentOverrideRecommendation(inImprovement)).toBe(true);
    expect(shouldJudgmentOverrideRecommendation(passedRecently)).toBe(true);
    expect(shouldJudgmentOverrideRecommendation(weakRecommended)).toBe(false);
    expect(getKnowledgeMasteryPrimaryLabel(lowConfidence, { recommended: true })).toBe('证据较少');
    expect(getKnowledgeMasteryPrimaryLabel(awaitingRetest, { recommended: true })).toBe('推荐 · 待复测');
    expect(getKnowledgeMasteryPrimaryLabel(inImprovement, { recommended: true })).toBe('推荐 · 提升中');
    expect(getKnowledgeMasteryPrimaryLabel(passedRecently, { recommended: true })).toBe('推荐 · 近期已通过');
    expect(getKnowledgeMasteryPrimaryLabel(weakRecommended, { recommended: true })).toBe('推荐');
  });

  it('provides compact retest labels without exposing backend enum names', () => {
    expect(getRetestJudgmentLabel({ passed: true }, judgment({
      masteryLevel: 'weak',
      interventionStatus: 'needs_retest',
      nextAction: 'retest',
    }))).toBe('近期已通过');
    expect(getRetestJudgmentLabel({ passed: false }, judgment({
      masteryLevel: 'mastered',
      interventionStatus: 'passed_recently',
      nextAction: 'maintain',
    }))).toBe('仍需巩固');
    expect(getRetestJudgmentLabel({ passed: false }, judgment({
      interventionStatus: 'awaiting_retest',
      nextAction: 'retest',
    }))).toBe('待复测');
    expect(getRetestJudgmentLabel({ passed: false }, judgment({
      confidence: 'low',
      masteryLevel: 'weak',
    }))).toBe('证据较少');
    expect(getRetestJudgmentLabel({ passed: false }, null)).toBeNull();
  });
});

describe('train mastery judgment summary helpers', () => {
  it('summarizes train entry judgment counts without exposing backend enum names', () => {
    const summary = summarizeKnowledgeMasteryJudgments([
      judgment({
        kpId: 'kp-improve',
        masteryLevel: 'developing',
        interventionStatus: 'in_improvement',
        nextAction: 'continue_improvement',
      }),
      judgment({
        kpId: 'kp-retest',
        masteryLevel: 'stable',
        interventionStatus: 'awaiting_retest',
        nextAction: 'retest',
      }),
      judgment({
        kpId: 'kp-passed',
        masteryLevel: 'mastered',
        interventionStatus: 'passed_recently',
        nextAction: 'maintain',
      }),
    ]);

    expect(summary).toMatchObject({
      total: 3,
      inImprovementCount: 1,
      awaitingRetestCount: 1,
      passedRecentlyCount: 1,
      recommendedNextAction: 'retest',
    });
    expect(getTrainJudgmentSummaryText(summary)).toBe('有 1 个知识点等待复测确认。');
    expect(getTrainJudgmentSummaryText(summary)).not.toContain('awaiting_retest');
  });

  it('keeps low-confidence judgments out of definite weak counts', () => {
    const summary = summarizeKnowledgeMasteryJudgments([
      judgment({
        kpId: 'kp-low',
        confidence: 'low',
        masteryLevel: 'weak',
        interventionStatus: 'needs_learning',
      }),
    ]);

    expect(summary.lowConfidenceCount).toBe(1);
    expect(summary.weakCount).toBe(0);
    expect(summary.recommendedNextAction).toBe('diagnose');
    expect(getTrainJudgmentSummaryText(summary)).toBe('部分知识点证据较少，建议先完成一次检测。');
  });

  it('adapts train action hint to existing entry state priority', () => {
    const activePlanSummary = summarizeKnowledgeMasteryJudgments([
      judgment({
        kpId: 'kp-active',
        interventionStatus: 'in_improvement',
        nextAction: 'continue_improvement',
      }),
    ]);
    const reportSummary = summarizeKnowledgeMasteryJudgments([
      judgment({
        kpId: 'kp-passed',
        masteryLevel: 'mastered',
        interventionStatus: 'passed_recently',
        nextAction: 'maintain',
      }),
    ]);

    expect(getTrainJudgmentActionHint(activePlanSummary, 'active_plan')).toBe('已有 1 个知识点进入提升路径，建议继续完成。');
    expect(getTrainJudgmentActionHint(reportSummary, 'completed_report')).toBe('近期已有 1 个知识点通过复测，可以查看提升报告。');
  });
});
