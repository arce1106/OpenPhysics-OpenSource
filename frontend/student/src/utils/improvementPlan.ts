import type {
  DirectoryData,
  DirectoryKpNode,
  ImprovementPlan,
  ImprovementRecommendedAction,
  ImprovementTask,
  ScopeDiagnosticResult,
  ScopeKpResult,
} from '../types';

const ACTION_REASONS: Record<ImprovementRecommendedAction, string> = {
  review_then_practice: '本次定位暴露基础不稳，建议先回看关键概念，再做一组专项练。',
  practice: '掌握还不稳定，建议完成一组针对性训练。',
  challenge: '基础较稳定，可以做一组提升题检查综合应用。',
  retest: '完成训练后建议复测，确认问题是否解决。',
};

function recommendedActionFor(item: ScopeKpResult, isWeak: boolean): ImprovementRecommendedAction {
  if (isWeak && item.mastery_after < 0.3) return 'review_then_practice';
  if (isWeak) return 'practice';
  if (item.mastery_after >= 0.75) return 'challenge';
  return 'practice';
}

function buildKpDirectoryIndex(dirData?: DirectoryData | null): Map<string, { node: DirectoryKpNode; order: number }> {
  const index = new Map<string, { node: DirectoryKpNode; order: number }>();
  dirData?.kps.forEach((node, order) => {
    index.set(node.id, { node, order });
  });
  return index;
}

function groupInfoFor(node?: DirectoryKpNode): { groupId: string | null; groupName: string | null } {
  if (!node?.section) {
    return { groupId: null, groupName: null };
  }
  return {
    groupId: node.chapter ? `${node.chapter}||${node.section}` : node.section,
    groupName: node.section,
  };
}

export function buildImprovementPlan(
  result: ScopeDiagnosticResult,
  dirData?: DirectoryData | null,
  now: Date = new Date(),
): ImprovementPlan {
  const createdAt = now.toISOString();
  const weakKpIds = new Set(result.weak_kp_ids);
  const directoryIndex = buildKpDirectoryIndex(dirData);
  const unsortedTasks = result.kp_results.map((item) => {
    const isWeak = weakKpIds.has(item.kp_id);
    const action = recommendedActionFor(item, isWeak);
    const directoryEntry = directoryIndex.get(item.kp_id);
    const group = groupInfoFor(directoryEntry?.node);

    return {
      id: `${result.scope_type}:${result.scope_id}:${item.kp_id}`,
      kpId: item.kp_id,
      kpName: item.kp_name,
      groupId: group.groupId,
      groupName: group.groupName,
      correctCount: item.correct_count,
      totalCount: item.total_count,
      masteryBefore: item.mastery_before,
      masteryAfter: item.mastery_after,
      isWeak,
      priority: 0,
      status: 'pending' as const,
      recommendedAction: action,
      reason: ACTION_REASONS[action],
      directoryOrder: directoryEntry?.order ?? Number.MAX_SAFE_INTEGER,
    };
  });

  const tasks: ImprovementTask[] = unsortedTasks
    .sort((a, b) => {
      if (a.isWeak !== b.isWeak) return a.isWeak ? -1 : 1;
      if (a.masteryAfter !== b.masteryAfter) return a.masteryAfter - b.masteryAfter;
      if ((a.totalCount > 0) !== (b.totalCount > 0)) return a.totalCount > 0 ? -1 : 1;
      if (a.directoryOrder !== b.directoryOrder) return a.directoryOrder - b.directoryOrder;
      return a.kpName.localeCompare(b.kpName, 'zh-Hans-CN');
    })
    .map(({ directoryOrder: _directoryOrder, ...task }, index) => ({
      ...task,
      priority: index + 1,
    }));

  return {
    id: `${result.scope_type}:${result.scope_id}:${createdAt}`,
    scopeType: result.scope_type,
    scopeId: result.scope_id,
    scopeName: result.scope_name,
    createdAt,
    correctCount: result.correct_count,
    totalCount: result.total_count,
    weakCount: result.weak_kp_ids.length,
    status: 'diagnosed',
    currentTaskId: tasks[0]?.id || null,
    tasks,
  };
}

export function getCurrentImprovementTask(plan: ImprovementPlan): ImprovementTask | null {
  return getNextActionableImprovementTask(plan);
}

export function getTaskById(plan: ImprovementPlan, taskId?: string | null): ImprovementTask | null {
  if (!taskId) return null;
  return plan.tasks.find(task => task.id === taskId) || null;
}

export function getNextActionableImprovementTask(plan: ImprovementPlan): ImprovementTask | null {
  if (plan.currentTaskId) {
    const current = getTaskById(plan, plan.currentTaskId);
    if (current && current.status !== 'practiced' && current.status !== 'passed') {
      return current;
    }
  }
  return [...plan.tasks]
    .sort((a, b) => a.priority - b.priority)
    .find(task => task.status === 'pending' || task.status === 'in_progress' || task.status === 'needs_retest') || null;
}

export function pickNextKpFromImprovementPlan(plan: ImprovementPlan): string | null {
  return getNextActionableImprovementTask(plan)?.kpId || null;
}

function statusAfterTaskUpdate(plan: ImprovementPlan, tasks: ImprovementTask[], status: ImprovementTask['status']): ImprovementPlan['status'] {
  if (tasks.length > 0 && tasks.every(task => task.status === 'practiced' || task.status === 'passed')) {
    return 'ready_for_retest';
  }
  if (status === 'in_progress') return 'in_progress';
  return plan.status;
}

export function updateImprovementTaskStatus(
  plan: ImprovementPlan,
  taskId: string,
  status: ImprovementTask['status'],
): ImprovementPlan {
  if (!plan.tasks.some(task => task.id === taskId)) return plan;
  const tasks = plan.tasks.map(task => (
    task.id === taskId ? { ...task, status } : task
  ));
  return {
    ...plan,
    status: statusAfterTaskUpdate(plan, tasks, status),
    tasks,
  };
}

export function moveToNextImprovementTask(plan: ImprovementPlan): ImprovementPlan {
  const nextTask = [...plan.tasks]
    .sort((a, b) => a.priority - b.priority)
    .find(task => task.status === 'pending' || task.status === 'needs_retest');

  if (!nextTask) {
    return {
      ...plan,
      currentTaskId: null,
      status: 'ready_for_retest',
    };
  }

  return {
    ...plan,
    currentTaskId: nextTask.id,
    status: plan.status === 'completed' ? plan.status : 'in_progress',
  };
}
