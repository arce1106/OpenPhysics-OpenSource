import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TrainScopeResultPanel from './TrainScopeResultPanel';
import type { ImprovementPlan, KnowledgeMasteryJudgment, ScopeDiagnosticResult } from '../../types';

const result: ScopeDiagnosticResult = {
  scope_type: 'chapter',
  scope_id: '运动的描述',
  scope_name: '运动的描述',
  correct_count: 1,
  total_count: 2,
  weak_kp_ids: ['kp-low'],
  recommendation: 'study',
  feedback: '先补坐标系。',
  kp_results: [
    {
      kp_id: 'kp-low',
      kp_name: '坐标系',
      correct_count: 0,
      total_count: 1,
      mastery_before: 0.1,
      mastery_after: 0.22,
    },
    {
      kp_id: 'kp-mid',
      kp_name: '参考系',
      correct_count: 1,
      total_count: 1,
      mastery_before: 0.3,
      mastery_after: 0.48,
    },
  ],
};

const plan: ImprovementPlan = {
  id: 'chapter:运动的描述:2026-06-27T01:00:00.000Z',
  scopeType: 'chapter',
  scopeId: '运动的描述',
  scopeName: '运动的描述',
  createdAt: '2026-06-27T01:00:00.000Z',
  correctCount: 1,
  totalCount: 2,
  weakCount: 1,
  status: 'diagnosed',
  currentTaskId: 'task-low',
  tasks: [
    {
      id: 'task-low',
      kpId: 'kp-low',
      kpName: '坐标系',
      groupId: '运动的描述||1.2 时间 位移',
      groupName: '1.2 时间 位移',
      correctCount: 0,
      totalCount: 1,
      masteryBefore: 0.1,
      masteryAfter: 0.22,
      isWeak: true,
      priority: 1,
      status: 'pending',
      recommendedAction: 'review_then_practice',
      reason: '本次定位暴露基础不稳，建议先回看关键概念，再做一组专项练。',
    },
    {
      id: 'task-mid',
      kpId: 'kp-mid',
      kpName: '参考系',
      groupId: null,
      groupName: null,
      correctCount: 1,
      totalCount: 1,
      masteryBefore: 0.3,
      masteryAfter: 0.48,
      isWeak: false,
      priority: 2,
      status: 'practiced',
      recommendedAction: 'practice',
      reason: '掌握还不稳定，建议完成一组针对性训练。',
    },
  ],
};

const colors = { bg: '#f0f5ff', border: '#91caff', text: '#0958d9', label: '建议先回看薄弱知识' };

function cssRule(selector: string): string {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = Array.from(css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g')));
  return matches.at(-1)?.[1] || '';
}

const inImprovementJudgment: KnowledgeMasteryJudgment = {
  kpId: 'kp-low',
  kpName: '坐标系',
  masteryScore: 0.22,
  masteryLevel: 'weak',
  interventionStatus: 'in_improvement',
  confidence: 'high',
  nextAction: 'continue_improvement',
  reason: '正在本轮提升计划中。',
  evidenceSources: ['scope_diagnostic'],
  evidences: [],
  recentCorrectCount: 0,
  recentTotalCount: 1,
};

describe('TrainScopeResultPanel', () => {
  it('renders an improvement path with grouped tasks and starts plan tasks by task id', async () => {
    const onStartTask = vi.fn();
    const onBack = vi.fn();

    const { container } = render(
      <TrainScopeResultPanel
        result={result}
        plan={plan}
        colors={colors}
        onLearnWeak={vi.fn()}
        onPractice={vi.fn()}
        onStartTask={onStartTask}
        onBack={onBack}
        onGoSync={vi.fn()}
      />,
    );

    const resultHeader = container.querySelector('.train-scope-result-header');
    expect(resultHeader).not.toBeNull();
    expect(resultHeader).toContainElement(screen.getByRole('button', { name: '返回' }));
    expect(container.querySelector('.train-scope-result-actions')).toBeNull();
    expect(screen.getByText('提升路径')).toBeInTheDocument();
    expect(screen.getByText('当前推荐任务')).toBeInTheDocument();
    const resultPanel = container.querySelector('.train-scope-result-panel');
    expect(resultPanel).not.toBeNull();
    expect(resultPanel?.querySelectorAll(':scope > .train-scope-result-section')).toHaveLength(3);
    expect(container.querySelector('.train-scope-result-recommendation')?.classList.contains('train-scope-result-section')).toBe(true);
    expect(container.querySelector('.train-scope-result-recommendation')).not.toHaveAttribute('style', expect.stringContaining('border-left'));
    expect(cssRule('.train-scope-result-recommendation')).not.toContain('border-left');
    expect(container.querySelector('.train-scope-current-task-section .train-improvement-current-card')).not.toBeNull();
    expect(container.querySelector('.train-scope-path-section .train-improvement-path')).not.toBeNull();
    expect(screen.getByText('修复「坐标系」')).toBeInTheDocument();
    expect(screen.getAllByText('掌握度 10%').length).toBeGreaterThan(0);
    expect(screen.queryByText('掌握度 22%')).toBeNull();
    expect(screen.getAllByText('10% → 10%').length).toBeGreaterThan(0);
    expect(screen.getByText('1.2 时间 位移')).toBeInTheDocument();
    expect(screen.getByText('未分组知识点')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: /掌握度/ })).toHaveLength(3);

    await userEvent.click(screen.getByRole('button', { name: '开始本步提升' }));
    expect(onStartTask).toHaveBeenCalledWith('task-low');
    await userEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('organizes each improvement task card into header, body, and action regions', () => {
    const { container } = render(
      <TrainScopeResultPanel
        result={result}
        plan={plan}
        colors={colors}
        onLearnWeak={vi.fn()}
        onPractice={vi.fn()}
        onStartTask={vi.fn()}
        onBack={vi.fn()}
        onGoSync={vi.fn()}
      />,
    );

    const taskCards = Array.from(container.querySelectorAll('.train-improvement-task'));
    expect(taskCards).toHaveLength(plan.tasks.length);
    taskCards.forEach(card => {
      expect(card.querySelector('.train-improvement-task-header')).not.toBeNull();
      expect(card.querySelector('.train-improvement-task-body')).not.toBeNull();
      expect(card.querySelector('.train-improvement-task-actions')).not.toBeNull();
    });
  });

  it('uses mastery progress instead of status and judgment badges on task cards', () => {
    const activePlan: ImprovementPlan = {
      ...plan,
      tasks: plan.tasks.map(task => (
        task.id === 'task-low'
          ? { ...task, status: 'in_progress' }
          : task
      )),
    };

    render(
      <TrainScopeResultPanel
        result={result}
        plan={activePlan}
        colors={colors}
        taskJudgments={{ 'kp-low': inImprovementJudgment }}
        onLearnWeak={vi.fn()}
        onPractice={vi.fn()}
        onStartTask={vi.fn()}
        onBack={vi.fn()}
        onGoSync={vi.fn()}
      />,
    );

    const currentCard = screen.getByText('修复「坐标系」').closest('.train-improvement-current-card');

    expect(currentCard).not.toBeNull();
    expect(currentCard?.querySelector('.train-improvement-task-badges')).toBeNull();
    expect(currentCard?.querySelector('.train-improvement-task-status')).toBeNull();
    expect(currentCard?.querySelector('.train-task-judgment-badge')).toBeNull();
    expect(currentCard?.querySelector('.train-mastery-progress')).not.toBeNull();
    expect(screen.queryByLabelText('统一判断：提升中')).not.toBeInTheDocument();
  });

  it('falls back to scope result actions when no plan is provided', async () => {
    const onPractice = vi.fn();

    render(
      <TrainScopeResultPanel
        result={result}
        colors={colors}
        onLearnWeak={vi.fn()}
        onPractice={onPractice}
        onBack={vi.fn()}
        onGoSync={vi.fn()}
      />,
    );

    expect(screen.getByText('知识点结果')).toBeInTheDocument();
    expect(screen.queryByText('薄弱点')).not.toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: /掌握度/ })).toHaveLength(result.kp_results.length);
    expect(screen.queryByRole('button', { name: '开始薄弱点提升' })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: '专项练' })[0]);
    expect(onPractice).toHaveBeenCalledWith('kp-low');
  });
});
