import { canonicalKpName } from './knowledgeNames';
import { totalResultCredit } from './resultCredit';
import type { SubmitResult } from '../types';

export interface MasteryChangeSummary {
  kpId: string;
  name: string;
  before: number;
  after: number;
}

export interface PracticeNextStep {
  kind: 'review' | 'continue';
  label: string;
  description: string;
}

export interface PracticeSummary {
  correctCount: number;
  totalCount: number;
  accuracy: number;
  masteryChanges: MasteryChangeSummary[];
  weakMasteryChanges: MasteryChangeSummary[];
  headline: string;
  nextStep: PracticeNextStep;
}

export function buildPracticeSummary(answers: Record<string, SubmitResult>): PracticeSummary {
  const values = Object.values(answers);
  const totalCount = values.length;
  const correctCount = totalResultCredit(values);
  const accuracy = totalCount > 0 ? correctCount / totalCount : 0;
  const masteryByKp: Record<string, MasteryChangeSummary> = {};

  values.forEach(answer => {
    Object.entries(answer.mastery_update || {}).forEach(([kpId, change]) => {
      if (!masteryByKp[kpId]) {
        masteryByKp[kpId] = {
          kpId,
          name: canonicalKpName(kpId, change.name),
          before: change.before,
          after: change.after,
        };
        return;
      }
      masteryByKp[kpId] = {
        ...masteryByKp[kpId],
        name: canonicalKpName(kpId, change.name),
        after: change.after,
      };
    });
  });

  const masteryChanges = Object.values(masteryByKp);
  const weakMasteryChanges = masteryChanges.filter(change => change.after < 0.5);
  const allCorrect = totalCount > 0 && accuracy >= 0.999;

  return {
    correctCount,
    totalCount,
    accuracy,
    masteryChanges,
    weakMasteryChanges,
    headline: allCorrect
      ? '本轮方法比较稳定，可以继续向综合题推进。'
      : '本轮已经暴露出需要修复的位置，先把错因闭环。',
    nextStep: allCorrect
      ? {
        kind: 'continue',
        label: '继续巩固',
        description: '保持当前节奏，进入下一组题或下一个知识点。',
      }
      : {
        kind: 'review',
        label: '去清除错题',
        description: '先复盘错题和第一处错误，再进入下一轮训练。',
      },
  };
}
