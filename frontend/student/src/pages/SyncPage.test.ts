import { describe, expect, it } from 'vitest';
import type { DirectoryKpNode, KnowledgeMasteryJudgment } from '../types';
import { getSyncKpActions, getSyncKpActionPath } from './SyncPage';
import { newPracticeRecord } from '../utils/practicePersistence';

function kp(overrides: Partial<DirectoryKpNode>): DirectoryKpNode {
  return {
    id: 'kp-1',
    name: '质点',
    volume: '必修 第一册',
    chapter: '第一章 运动的描述',
    section: '1.1 质点 参考系',
    mastery: 0,
    status: 'needs_learning',
    learning_state: 'to_learn',
    learning_state_label: '待学习',
    learning_state_tone: 'learning',
    ...overrides,
  } as DirectoryKpNode;
}

function judgment(overrides: Partial<KnowledgeMasteryJudgment>): KnowledgeMasteryJudgment {
  return {
    kpId: 'kp-1',
    kpName: '质点',
    masteryScore: 0.12,
    masteryLevel: 'weak',
    interventionStatus: 'in_improvement',
    confidence: 'high',
    nextAction: 'continue_improvement',
    reason: '该知识点已进入巩固提升路径，请继续完成提升任务。',
    evidenceSources: [],
    evidences: [],
    recentCorrectCount: 0,
    recentTotalCount: 0,
    ...overrides,
  };
}

describe('SyncPage knowledge point actions', () => {
  it('keeps an unfinished assessment reachable even after partial grading creates practice evidence', () => {
    const record = newPracticeRecord('student', 'assessment', { session: { questions: [{ id: 'q1' }, { id: 'q2' }] } });
    record.answers.q1 = { answer_id: 1, is_correct: false, correct_answer: 'B', mastery_update: {}, explanation: null };
    expect(getSyncKpActions(kp({ learning_state: 'practice' }), null, record).primary)
      .toEqual({ label: '继续评估', kind: 'check' });
  });

  it('uses consolidation after assessment feedback even when directory prerequisites are stale', () => {
    const record = newPracticeRecord('student', 'assessment', {
      session: { questions: [{ id: 'q1' }] }, diagnosticResult: { recommendation: 'practice' },
    });
    record.answers.q1 = { answer_id: 1, is_correct: false, correct_answer: 'B', mastery_update: {}, explanation: null };
    expect(getSyncKpActions(kp({ mastery: 0.73, learning_state: 'locked' }), null, record).primary)
      .toEqual({ label: '巩固小练', kind: 'train' });
  });
  it('routes mastered knowledge points to consolidation instead of another mastery assessment', () => {
    const actions = getSyncKpActions(kp({
      mastery: 1,
      status: 'mastered',
      learning_state: 'mastered',
      learning_state_label: '已掌握',
      learning_state_tone: 'mastered',
    }));

    expect(actions.primary).toEqual({ label: '巩固小练', kind: 'train' });
    expect(actions.secondary).toEqual({ label: '回看知识卡', kind: 'learn' });
  });

  it('keeps mastery assessment for knowledge points that still need learning confirmation', () => {
    const actions = getSyncKpActions(kp({
      mastery: 0,
      status: 'needs_learning',
      learning_state: 'to_learn',
      learning_state_label: '待学习',
      learning_state_tone: 'learning',
    }));

    expect(actions.primary).toEqual({ label: '开始学习', kind: 'learn' });
    expect(actions.secondary).toEqual({ label: '掌握评估', kind: 'check' });
  });

  it('uses consolidation for backend practice state', () => {
    const actions = getSyncKpActions(kp({
      mastery: 0.45,
      status: 'needs_learning',
      learning_state: 'practice',
      learning_state_label: '待巩固',
      learning_state_tone: 'practice',
    }));

    expect(actions.primary).toEqual({ label: '巩固小练', kind: 'train' });
    expect(actions.secondary).toEqual({ label: '回看知识卡', kind: 'learn' });
  });

  it('does not let mastery judgment actions redirect sync practice to improvement routes', () => {
    const actions = getSyncKpActions(
      kp({
        mastery: 0.12,
        status: 'needs_learning',
        learning_state: 'practice',
        learning_state_label: '待巩固',
        learning_state_tone: 'practice',
      }),
      judgment({
        nextAction: 'continue_improvement',
        interventionStatus: 'in_improvement',
      }),
    );

    expect(actions.primary).toEqual({ label: '巩固小练', kind: 'train' });
    expect(actions.secondary).toEqual({ label: '回看知识卡', kind: 'learn' });
  });

  it('does not let retest judgments replace the sync knowledge point practice CTA', () => {
    const actions = getSyncKpActions(
      kp({
        mastery: 0.72,
        status: 'mastered',
        learning_state: 'mastered',
        learning_state_label: '已掌握',
        learning_state_tone: 'mastered',
      }),
      judgment({
        masteryScore: 0.72,
        masteryLevel: 'stable',
        interventionStatus: 'awaiting_retest',
        nextAction: 'retest',
      }),
    );

    expect(actions.primary).toEqual({ label: '巩固小练', kind: 'train' });
    expect(actions.secondary).toEqual({ label: '回看知识卡', kind: 'learn' });
  });

  it('routes knowledge point consolidation directly to practice questions', () => {
    expect(getSyncKpActionPath('train', 'kp-1')).toBe('/learn/check?kp=kp-1&count=5&mode=practice');
  });
});
