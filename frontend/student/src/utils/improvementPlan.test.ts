import { describe, expect, it } from 'vitest';
import {
  buildImprovementPlan,
  getCurrentImprovementTask,
  getNextActionableImprovementTask,
  getTaskById,
  moveToNextImprovementTask,
  pickNextKpFromImprovementPlan,
  updateImprovementTaskStatus,
} from './improvementPlan';
import type { DirectoryData, ImprovementPlan, ScopeDiagnosticResult } from '../types';

const scopeResult: ScopeDiagnosticResult = {
  scope_type: 'chapter',
  scope_id: '运动的描述',
  scope_name: '第一章 运动的描述',
  correct_count: 1,
  total_count: 4,
  weak_kp_ids: ['kp-mid', 'kp-low', 'kp-zero'],
  recommendation: 'study',
  feedback: '先补薄弱点。',
  kp_results: [
    {
      kp_id: 'kp-stable',
      kp_name: '质点',
      correct_count: 1,
      total_count: 1,
      mastery_before: 0.7,
      mastery_after: 0.82,
    },
    {
      kp_id: 'kp-mid',
      kp_name: '参考系',
      correct_count: 0,
      total_count: 1,
      mastery_before: 0.25,
      mastery_after: 0.45,
    },
    {
      kp_id: 'kp-low',
      kp_name: '坐标系',
      correct_count: 0,
      total_count: 1,
      mastery_before: 0.1,
      mastery_after: 0.22,
    },
    {
      kp_id: 'kp-zero',
      kp_name: '位置',
      correct_count: 0,
      total_count: 0,
      mastery_before: 0.1,
      mastery_after: 0.22,
    },
  ],
};

const directory: DirectoryData = {
  kps: [
    {
      id: 'kp-stable',
      name: '质点',
      volume: '必修 第一册',
      chapter: '运动的描述',
      section: '1.1 质点 参考系',
      mastery: 0.82,
      status: 'mastered',
      blocked_by: [],
      last_practiced: null,
    },
    {
      id: 'kp-mid',
      name: '参考系',
      volume: '必修 第一册',
      chapter: '运动的描述',
      section: '1.1 质点 参考系',
      mastery: 0.45,
      status: 'needs_learning',
      blocked_by: [],
      last_practiced: null,
    },
    {
      id: 'kp-low',
      name: '坐标系',
      volume: '必修 第一册',
      chapter: '运动的描述',
      section: '1.2 时间 位移',
      mastery: 0.22,
      status: 'needs_learning',
      blocked_by: [],
      last_practiced: null,
    },
    {
      id: 'kp-zero',
      name: '位置',
      volume: '必修 第一册',
      chapter: '运动的描述',
      section: '1.2 时间 位移',
      mastery: 0.22,
      status: 'needs_learning',
      blocked_by: [],
      last_practiced: null,
    },
  ],
  stats: {
    mastered: 1,
    in_progress: 3,
    locked: 0,
    total: 4,
  },
  relations: [],
};

describe('improvementPlan', () => {
  it('builds a sorted improvement plan with group metadata and current task', () => {
    const now = new Date('2026-06-27T01:00:00.000Z');

    const plan = buildImprovementPlan(scopeResult, directory, now);

    expect(plan).toMatchObject({
      id: 'chapter:运动的描述:2026-06-27T01:00:00.000Z',
      scopeType: 'chapter',
      scopeId: '运动的描述',
      scopeName: '第一章 运动的描述',
      createdAt: '2026-06-27T01:00:00.000Z',
      correctCount: 1,
      totalCount: 4,
      weakCount: 3,
      status: 'diagnosed',
    });
    expect(plan.tasks.map(task => task.kpId)).toEqual(['kp-low', 'kp-zero', 'kp-mid', 'kp-stable']);
    expect(plan.currentTaskId).toBe('chapter:运动的描述:kp-low');
    expect(plan.tasks.map(task => task.priority)).toEqual([1, 2, 3, 4]);
    expect(plan.tasks[0]).toMatchObject({
      id: 'chapter:运动的描述:kp-low',
      kpName: '坐标系',
      groupId: '运动的描述||1.2 时间 位移',
      groupName: '1.2 时间 位移',
      isWeak: true,
      status: 'pending',
      recommendedAction: 'review_then_practice',
      reason: '本次定位暴露基础不稳，建议先回看关键概念，再做一组专项练。',
    });
    expect(plan.tasks[2]).toMatchObject({
      kpId: 'kp-mid',
      recommendedAction: 'practice',
      reason: '掌握还不稳定，建议完成一组针对性训练。',
    });
    expect(plan.tasks[3]).toMatchObject({
      kpId: 'kp-stable',
      recommendedAction: 'challenge',
      reason: '基础较稳定，可以做一组提升题检查综合应用。',
    });
  });

  it('builds a plan without directory data', () => {
    const plan = buildImprovementPlan(scopeResult, null, new Date('2026-06-27T01:00:00.000Z'));

    expect(plan.tasks).toHaveLength(4);
    expect(plan.tasks[0].groupId).toBeNull();
    expect(plan.tasks[0].groupName).toBeNull();
    expect(plan.currentTaskId).toBe(plan.tasks[0].id);
  });

  it('finds the current task and falls back to pending tasks', () => {
    const plan = buildImprovementPlan(scopeResult, directory, new Date('2026-06-27T01:00:00.000Z'));

    expect(getCurrentImprovementTask(plan)?.kpId).toBe('kp-low');

    const invalidCurrent: ImprovementPlan = {
      ...plan,
      currentTaskId: 'missing-task',
      tasks: [
        { ...plan.tasks[0], status: 'passed' },
        { ...plan.tasks[1], status: 'in_progress' },
        { ...plan.tasks[2], status: 'pending' },
      ],
    };
    expect(getCurrentImprovementTask(invalidCurrent)?.kpId).toBe('kp-zero');

    expect(getCurrentImprovementTask({ ...plan, currentTaskId: null, tasks: [] })).toBeNull();
  });

  it('skips practiced and passed tasks when selecting the next actionable task', () => {
    const plan = buildImprovementPlan(scopeResult, directory, new Date('2026-06-27T01:00:00.000Z'));
    const completedCurrent: ImprovementPlan = {
      ...plan,
      tasks: [
        { ...plan.tasks[0], status: 'practiced' },
        { ...plan.tasks[1], status: 'passed' },
        { ...plan.tasks[2], status: 'needs_retest' },
        { ...plan.tasks[3], status: 'pending' },
      ],
    };

    expect(getTaskById(plan, plan.tasks[0].id)?.kpId).toBe('kp-low');
    expect(getTaskById(plan, 'missing-task')).toBeNull();
    expect(getNextActionableImprovementTask(completedCurrent)?.kpId).toBe('kp-mid');
    expect(getCurrentImprovementTask(completedCurrent)?.kpId).toBe('kp-mid');
    expect(pickNextKpFromImprovementPlan(completedCurrent)).toBe('kp-mid');
  });

  it('updates task status immutably and marks the plan ready for retest after all tasks are practiced', () => {
    const plan = buildImprovementPlan(scopeResult, directory, new Date('2026-06-27T01:00:00.000Z'));

    const inProgress = updateImprovementTaskStatus(plan, plan.tasks[0].id, 'in_progress');
    expect(inProgress).not.toBe(plan);
    expect(plan.tasks[0].status).toBe('pending');
    expect(inProgress.status).toBe('in_progress');
    expect(inProgress.tasks[0].status).toBe('in_progress');

    const untouched = updateImprovementTaskStatus(plan, 'missing-task', 'practiced');
    expect(untouched).toBe(plan);

    const almostDone: ImprovementPlan = {
      ...plan,
      status: 'in_progress',
      tasks: [
        { ...plan.tasks[0], status: 'in_progress' },
        { ...plan.tasks[1], status: 'practiced' },
        { ...plan.tasks[2], status: 'passed' },
        { ...plan.tasks[3], status: 'practiced' },
      ],
    };
    const readyForRetest = updateImprovementTaskStatus(almostDone, plan.tasks[0].id, 'practiced');
    expect(readyForRetest.status).toBe('ready_for_retest');
    expect(readyForRetest.tasks[0].status).toBe('practiced');
  });

  it('moves to the next pending task and finishes the plan when none remain', () => {
    const plan = buildImprovementPlan(scopeResult, directory, new Date('2026-06-27T01:00:00.000Z'));
    const practicedFirst: ImprovementPlan = {
      ...plan,
      tasks: [
        { ...plan.tasks[0], status: 'practiced' },
        { ...plan.tasks[1], status: 'pending' },
        { ...plan.tasks[2], status: 'pending' },
        { ...plan.tasks[3], status: 'pending' },
      ],
    };

    const next = moveToNextImprovementTask(practicedFirst);
    expect(next.currentTaskId).toBe(plan.tasks[1].id);
    expect(next.status).toBe('in_progress');

    const completed = moveToNextImprovementTask({
      ...plan,
      status: 'in_progress',
      tasks: plan.tasks.map(task => ({ ...task, status: 'practiced' })),
    });
    expect(completed.currentTaskId).toBeNull();
    expect(completed.status).toBe('ready_for_retest');
  });

  it('picks the next kp from the current task', () => {
    const plan = buildImprovementPlan(scopeResult, directory, new Date('2026-06-27T01:00:00.000Z'));

    expect(pickNextKpFromImprovementPlan(plan)).toBe('kp-low');
    expect(pickNextKpFromImprovementPlan({ ...plan, currentTaskId: null, tasks: [] })).toBeNull();
  });
});
