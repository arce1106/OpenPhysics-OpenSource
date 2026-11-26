import { hasKpContent } from '../../utils/learningAccess';
import type { DirectoryKpNode } from '../../types';

export type LearningKpTone = 'mastered' | 'learning' | 'practice' | 'locked';
export type LearningState = NonNullable<DirectoryKpNode['learning_state']>;

export function learningStateFor(kp: DirectoryKpNode): LearningState {
  return kp.learning_state || 'locked';
}

export function firstKpByLearningState(kps: DirectoryKpNode[], states: LearningState[]) {
  for (const state of states) {
    const match = kps.find(kp => learningStateFor(kp) === state);
    if (match) return match;
  }
  return null;
}

export function hasLearningState(kp: DirectoryKpNode, states: LearningState[]) {
  return states.includes(learningStateFor(kp));
}

function stateCopy(state: LearningState): { label: string; tone: LearningKpTone } {
  if (state === 'pending_content') return { label: '内容待补充', tone: 'locked' };
  if (state === 'mastered') return { label: '已掌握', tone: 'mastered' };
  if (state === 'learning') return { label: '学习中', tone: 'learning' };
  if (state === 'to_learn') return { label: '待学习', tone: 'learning' };
  if (state === 'practice') return { label: '待巩固', tone: 'practice' };
  return { label: '未开始', tone: 'locked' };
}

export function getLearningKpStatus(kp: DirectoryKpNode): { label: string; tone: LearningKpTone } {
  if (kp.learning_state_label && kp.learning_state_tone) {
    return { label: kp.learning_state_label, tone: kp.learning_state_tone };
  }
  return stateCopy(learningStateFor(kp));
}

export function buildDirectoryKpStats(kps: DirectoryKpNode[]) {
  const mastered = kps.filter(kp => learningStateFor(kp) === 'mastered').length;
  const toLearn = kps.filter(kp => learningStateFor(kp) === 'to_learn').length;
  const practice = kps.filter(kp => learningStateFor(kp) === 'practice').length;
  const learning = kps.filter(kp => learningStateFor(kp) === 'learning').length;
  const available = kps.filter(hasKpContent);
  const avgMastery = available.length > 0 ? available.reduce((sum, kp) => sum + kp.mastery, 0) / available.length : 0;

  return {
    total: kps.length,
    mastered,
    toLearn,
    learning,
    practice,
    avgMastery,
  };
}
