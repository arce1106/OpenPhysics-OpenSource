import type { KnowledgeMasteryJudgment } from '../types';

export type KnowledgeMasterySyncActionKind = 'learn' | 'check' | 'train' | 'improvement';
export type KnowledgeMasterySyncTone = 'mastered' | 'learning' | 'practice' | 'locked';

export type TrainJudgmentExistingState = 'entry' | 'active_plan' | 'completed_report';

export type TrainJudgmentRecommendedAction =
  | 'continue_improvement'
  | 'retest'
  | 'diagnose'
  | 'report'
  | 'maintain'
  | null;

export interface TrainJudgmentSummary {
  total: number;
  weakCount: number;
  developingCount: number;
  stableCount: number;
  masteredCount: number;
  inImprovementCount: number;
  awaitingRetestCount: number;
  needsRetestCount: number;
  passedRecentlyCount: number;
  lowConfidenceCount: number;
  recommendedNextAction: TrainJudgmentRecommendedAction;
}

interface KnowledgeMasteryDisplayFallback {
  label: string;
  reason: string;
  tone?: KnowledgeMasterySyncTone;
  masteryPct?: number | null;
}

export interface KnowledgeMasteryDisplayBadge {
  label: string;
  reason: string;
  tone: KnowledgeMasterySyncTone;
  masteryPct: number | null;
  isJudgmentBased: boolean;
}

const MASTERY_LEVEL_TEXT: Record<string, string> = {
  weak: '薄弱',
  developing: '发展中',
  stable: '较稳定',
  mastered: '已掌握',
};

export function getKnowledgeMasteryPriority(judgment: KnowledgeMasteryJudgment | null | undefined): number {
  if (!judgment) return 0;
  if (judgment.confidence === 'low') return 100;
  if (judgment.interventionStatus === 'awaiting_retest' || judgment.interventionStatus === 'needs_retest') return 90;
  if (judgment.interventionStatus === 'in_improvement') return 80;
  if (judgment.interventionStatus === 'passed_recently') return 70;
  if (judgment.masteryLevel === 'weak') return 60;
  if (judgment.masteryLevel === 'developing') return 55;
  if (judgment.masteryLevel === 'stable') return 50;
  if (judgment.masteryLevel === 'mastered') return 45;
  return 10;
}

export function shouldJudgmentOverrideRecommendation(judgment: KnowledgeMasteryJudgment | null | undefined): boolean {
  if (!judgment) return false;
  return getKnowledgeMasteryPriority(judgment) >= 70;
}

export function getKnowledgeMasteryDisplayText(level: string | null | undefined): string {
  if (!level) return '建议先学习';
  return MASTERY_LEVEL_TEXT[level] || '建议先学习';
}

export function getKnowledgeMasteryPrimaryLabel(
  judgment: KnowledgeMasteryJudgment | null | undefined,
  options: {
    recommended?: boolean;
    fallbackLabel?: string;
  } = {},
): string {
  if (!judgment) return options.recommended ? '推荐' : options.fallbackLabel || '建议先学习';
  if (judgment.confidence === 'low') return '证据较少';
  let label: string;
  if (judgment.interventionStatus === 'in_improvement') label = '提升中';
  else if (judgment.interventionStatus === 'awaiting_retest' || judgment.interventionStatus === 'needs_retest') {
    label = '待复测';
  } else if (judgment.interventionStatus === 'passed_recently') label = '近期已通过';
  else label = getKnowledgeMasteryDisplayText(judgment.masteryLevel);

  if (options.recommended) {
    return shouldJudgmentOverrideRecommendation(judgment) ? `推荐 · ${label}` : '推荐';
  }
  return label;
}

export function getRetestJudgmentLabel(
  taskResult: { passed: boolean },
  judgment: KnowledgeMasteryJudgment | null | undefined,
): string | null {
  if (taskResult.passed) return '近期已通过';
  if (!judgment) return null;
  if (judgment.confidence === 'low') return '证据较少';
  if (judgment.interventionStatus === 'awaiting_retest' || judgment.interventionStatus === 'needs_retest') {
    return '待复测';
  }
  return '仍需巩固';
}

function toPct(score: number | null | undefined): number | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

function masteryDisplayToneFor(judgment: KnowledgeMasteryJudgment): KnowledgeMasterySyncTone {
  if (judgment.confidence === 'low') return 'learning';
  if (judgment.masteryLevel === 'stable' || judgment.masteryLevel === 'mastered') return 'mastered';
  if (judgment.masteryLevel === 'developing') return 'practice';
  return 'learning';
}

function masteryDisplayReasonFor(judgment: KnowledgeMasteryJudgment): string {
  if (judgment.confidence === 'low') return '当前证据较少，建议先学习或完成掌握评估。';
  if (judgment.masteryLevel === 'developing') return '已有一定基础，建议通过巩固小练继续熟悉。';
  if (judgment.masteryLevel === 'stable') return '当前掌握较稳定，可以通过巩固小练保持手感。';
  if (judgment.masteryLevel === 'mastered') return '当前掌握较好，可以按需回看知识卡或巩固小练。';
  return '当前基础证据较弱，建议先学习知识点讲解。';
}

export function mapKnowledgeMasteryJudgmentToMasteryDisplay(
  judgment: KnowledgeMasteryJudgment | null | undefined,
  fallback: KnowledgeMasteryDisplayFallback = {
    label: '建议先学习',
    reason: '建议先学习知识卡片，再用小测确认理解。',
    tone: 'learning',
    masteryPct: null,
  },
): KnowledgeMasteryDisplayBadge {
  if (!judgment) {
    return {
      label: fallback.label,
      reason: fallback.reason,
      tone: fallback.tone || 'learning',
      masteryPct: fallback.masteryPct ?? null,
      isJudgmentBased: false,
    };
  }

  return {
    label: judgment.confidence === 'low' ? '证据较少' : getKnowledgeMasteryDisplayText(judgment.masteryLevel),
    reason: masteryDisplayReasonFor(judgment),
    tone: masteryDisplayToneFor(judgment),
    masteryPct: toPct(judgment.masteryScore),
    isJudgmentBased: true,
  };
}

export function summarizeKnowledgeMasteryJudgments(
  judgments: Array<KnowledgeMasteryJudgment | null | undefined>,
): TrainJudgmentSummary {
  const summary: TrainJudgmentSummary = {
    total: 0,
    weakCount: 0,
    developingCount: 0,
    stableCount: 0,
    masteredCount: 0,
    inImprovementCount: 0,
    awaitingRetestCount: 0,
    needsRetestCount: 0,
    passedRecentlyCount: 0,
    lowConfidenceCount: 0,
    recommendedNextAction: null,
  };
  const seen = new Set<string>();

  judgments.forEach((judgment, index) => {
    if (!judgment) return;
    const key = judgment.kpId || `index-${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    summary.total += 1;

    if (judgment.confidence === 'low') {
      summary.lowConfidenceCount += 1;
      return;
    }

    if (judgment.masteryLevel === 'weak') summary.weakCount += 1;
    if (judgment.masteryLevel === 'developing') summary.developingCount += 1;
    if (judgment.masteryLevel === 'stable') summary.stableCount += 1;
    if (judgment.masteryLevel === 'mastered') summary.masteredCount += 1;

    if (judgment.interventionStatus === 'in_improvement') summary.inImprovementCount += 1;
    if (judgment.interventionStatus === 'awaiting_retest') summary.awaitingRetestCount += 1;
    if (judgment.interventionStatus === 'needs_retest') summary.needsRetestCount += 1;
    if (judgment.interventionStatus === 'passed_recently') summary.passedRecentlyCount += 1;
  });

  const retestCount = summary.awaitingRetestCount + summary.needsRetestCount;
  const needsWorkCount = summary.weakCount + summary.developingCount;
  if (retestCount > 0) {
    summary.recommendedNextAction = 'retest';
  } else if (summary.inImprovementCount > 0) {
    summary.recommendedNextAction = 'continue_improvement';
  } else if (needsWorkCount > 0) {
    summary.recommendedNextAction = 'diagnose';
  } else if (summary.passedRecentlyCount > 0) {
    summary.recommendedNextAction = 'report';
  } else if (summary.lowConfidenceCount > 0) {
    summary.recommendedNextAction = 'diagnose';
  } else if (summary.total > 0) {
    summary.recommendedNextAction = 'maintain';
  }

  return summary;
}

export function getTrainJudgmentSummaryText(summary: TrainJudgmentSummary): string {
  const retestCount = summary.awaitingRetestCount + summary.needsRetestCount;
  if (retestCount > 0) return `有 ${retestCount} 个知识点等待复测确认。`;
  if (summary.inImprovementCount > 0) {
    return `已有 ${summary.inImprovementCount} 个知识点进入提升路径，建议继续完成。`;
  }
  const needsWorkCount = summary.weakCount + summary.developingCount;
  if (needsWorkCount > 0) return `这个范围还有 ${needsWorkCount} 个知识点需要重点巩固。`;
  if (summary.passedRecentlyCount > 0) return `近期已有 ${summary.passedRecentlyCount} 个知识点通过复测，可以查看提升报告。`;
  if (summary.lowConfidenceCount > 0) return '部分知识点证据较少，建议先完成一次检测。';
  if (summary.total > 0) return '当前掌握较稳定，可以继续保持或查看学习轨迹。';
  return '暂无可汇总的掌握判读。';
}

export function getTrainJudgmentActionHint(
  summary: TrainJudgmentSummary,
  existingTrainState: TrainJudgmentExistingState,
): string {
  const retestCount = summary.awaitingRetestCount + summary.needsRetestCount;
  const needsWorkCount = summary.weakCount + summary.developingCount;

  if (existingTrainState === 'active_plan') {
    if (retestCount > 0) return '部分知识点已完成练习，建议进行复测确认。';
    if (summary.inImprovementCount > 0) {
      return `已有 ${summary.inImprovementCount} 个知识点进入提升路径，建议继续完成。`;
    }
    return '当前已有提升路径，建议按路径继续完成。';
  }

  if (existingTrainState === 'completed_report') {
    if (summary.passedRecentlyCount > 0) {
      return `近期已有 ${summary.passedRecentlyCount} 个知识点通过复测，可以查看提升报告。`;
    }
    if (needsWorkCount > 0) return '报告之外，当前范围仍有知识点建议继续巩固。';
    return '最近提升闭环已完成，可以查看报告或学习轨迹。';
  }

  if (summary.lowConfidenceCount > 0 && needsWorkCount === 0) {
    return '证据还不够充分，建议先完成检测，再决定是否进入提升。';
  }
  if (needsWorkCount > 0) return '建议先完成本范围检测，再进入针对性训练。';
  return getTrainJudgmentSummaryText(summary);
}
