import { describe, expect, it } from 'vitest';
import type { DirectoryKpNode } from '../../types';
import { buildDirectoryKpStats, getLearningKpStatus } from './learningKpStatus';

function kp(overrides: Partial<DirectoryKpNode>): DirectoryKpNode {
  return {
    id: 'kp',
    name: '知识点',
    volume: null,
    chapter: null,
    section: null,
    mastery: 0,
    status: 'locked',
    blocked_by: [],
    last_practiced: null,
    ...overrides,
  } as DirectoryKpNode;
}

describe('learning knowledge point status copy', () => {
  it('uses backend to-learn state for untouched knowledge points', () => {
    expect(getLearningKpStatus(kp({
      status: 'needs_learning',
      mastery: 0,
      learning_state: 'to_learn',
      learning_state_label: '待学习',
      learning_state_tone: 'learning',
    }))).toEqual({
      label: '待学习',
      tone: 'learning',
    });
  });

  it('uses backend learning state labels when present', () => {
    expect(getLearningKpStatus(kp({
      status: 'needs_learning',
      mastery: 0,
      learning_state: 'practice',
      learning_state_label: '后端待巩固',
      learning_state_tone: 'practice',
    }))).toEqual({
      label: '后端待巩固',
      tone: 'practice',
    });
  });

  it('does not infer learning state when backend learning state is missing', () => {
    expect(getLearningKpStatus(kp({ status: 'needs_learning', mastery: 0.25 }))).toEqual({
      label: '未开始',
      tone: 'locked',
    });
  });

  it('counts only attempted low-mastery knowledge points as consolidation work', () => {
    const stats = buildDirectoryKpStats([
      kp({ id: 'fresh', status: 'needs_learning', mastery: 0, learning_state: 'to_learn' }),
      kp({ id: 'weak', status: 'needs_learning', mastery: 0.25, learning_state: 'practice' }),
      kp({ id: 'current', status: 'current', mastery: 0.5, learning_state: 'learning' }),
      kp({ id: 'mastered', status: 'mastered', mastery: 0.85, learning_state: 'mastered' }),
    ]);

    expect(stats.toLearn).toBe(1);
    expect(stats.practice).toBe(1);
    expect(stats.learning).toBe(1);
    expect(stats.mastered).toBe(1);
  });
});
