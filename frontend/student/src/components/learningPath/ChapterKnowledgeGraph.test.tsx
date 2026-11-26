import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DirectoryKpNode, KnowledgeMasteryJudgment } from '../../types';
import ChapterKnowledgeGraph from './ChapterKnowledgeGraph';

it('shows pending content without a zero mastery score or practice recommendation', () => {
  render(<ChapterKnowledgeGraph kps={[kp({ name: '待补知识点', status: 'pending_content',
    learning_state: 'pending_content', content_available: false, practice_available: false })]}
    recommendedKpId="kp-1" onOpenKp={vi.fn()} />);
  expect(screen.getByRole('button', { name: /待补知识点/ })).toHaveAttribute('title', '待补知识点，内容待补充');
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
  expect(screen.queryByText('推荐')).not.toBeInTheDocument();
});

function kp(overrides: Partial<DirectoryKpNode>): DirectoryKpNode {
  return {
    id: 'kp-1',
    name: '质点',
    volume: '必修 第一册',
    chapter: '第一章 运动的描述',
    section: '1.1 质点 参考系',
    mastery: 0.2,
    status: 'needs_learning',
    learning_state: 'to_learn',
    learning_state_label: '未开始',
    learning_state_tone: 'learning',
    blocked_by: [],
    last_practiced: null,
    ...overrides,
  };
}

function judgment(overrides: Partial<KnowledgeMasteryJudgment>): KnowledgeMasteryJudgment {
  return {
    kpId: 'kp-1',
    kpName: '质点',
    masteryScore: 0.2,
    masteryLevel: 'weak',
    interventionStatus: 'needs_learning',
    confidence: 'high',
    nextAction: 'learn',
    reason: '建议先学习。',
    evidenceSources: [],
    evidences: [],
    recentCorrectCount: 0,
    recentTotalCount: 0,
    ...overrides,
  };
}

describe('ChapterKnowledgeGraph judgment labels', () => {
  it.each([[0, 'weak'], [39, 'weak'], [40, 'developing'], [69, 'developing'], [70, 'stable'], [79, 'stable'], [80, 'mastered'], [100, 'mastered']])(
    'uses the displayed percentage at the %s percent boundary, retaining evidence labels', (pct, band) => {
      render(<ChapterKnowledgeGraph kps={[kp({ mastery: Number(pct) / 100 })]}
        masteryJudgments={{ 'kp-1': judgment({ masteryScore: Number(pct) / 100, confidence: 'low' }) }} onOpenKp={vi.fn()} />);
      expect(screen.getByTitle(/质点，证据较少/)).toHaveClass(`mastery-${band}`);
      expect(screen.getByRole('group', { name: '掌握度颜色图例' })).toHaveTextContent('80–100%');
    },
  );

  it('uses mastery score tiers for graph colors instead of judgment action tone', () => {
    render(
      <ChapterKnowledgeGraph
        kps={[
          kp({ id: 'kp-critical', name: '零基础', mastery: 0 }),
          kp({ id: 'kp-weak', name: '低掌握', mastery: 0.12 }),
          kp({ id: 'kp-developing', name: '发展中', mastery: 0.55 }),
          kp({ id: 'kp-stable', name: '较稳定', mastery: 0.75 }),
          kp({ id: 'kp-mastered', name: '已掌握', mastery: 0.92 }),
        ]}
        masteryJudgments={{
          'kp-critical': judgment({ kpId: 'kp-critical', kpName: '零基础', masteryScore: 0, masteryLevel: 'weak', interventionStatus: 'in_improvement', nextAction: 'continue_improvement' }),
          'kp-weak': judgment({ kpId: 'kp-weak', kpName: '低掌握', masteryScore: 0.12, masteryLevel: 'weak', interventionStatus: 'in_improvement', nextAction: 'continue_improvement' }),
          'kp-developing': judgment({ kpId: 'kp-developing', kpName: '发展中', masteryScore: 0.55, masteryLevel: 'developing', interventionStatus: 'in_improvement', nextAction: 'continue_improvement' }),
          'kp-stable': judgment({ kpId: 'kp-stable', kpName: '较稳定', masteryScore: 0.75, masteryLevel: 'stable', interventionStatus: 'in_improvement', nextAction: 'continue_improvement' }),
          'kp-mastered': judgment({ kpId: 'kp-mastered', kpName: '已掌握', masteryScore: 0.92, masteryLevel: 'mastered', interventionStatus: 'in_improvement', nextAction: 'continue_improvement' }),
        }}
        onOpenKp={vi.fn()}
      />,
    );

    expect(screen.getByTitle(/零基础/)).toHaveClass('mastery-weak');
    expect(screen.getByTitle(/低掌握/)).toHaveClass('mastery-weak');
    expect(screen.getByTitle(/发展中/)).toHaveClass('mastery-developing');
    expect(screen.getByTitle(/较稳定/)).toHaveClass('mastery-stable');
    expect(screen.getByTitle(/已掌握/)).toHaveClass('mastery-mastered');
    expect(screen.queryByTitle(/提升中/)).not.toBeInTheDocument();
  });

  it('shows a pending graph state while mastery judgments are loading', () => {
    render(
      <ChapterKnowledgeGraph
        kps={[kp({ id: 'kp-loading', name: '速度', mastery: 0.12 })]}
        masteryJudgmentsLoading
        onOpenKp={vi.fn()}
      />,
    );

    const node = screen.getByTitle('速度，掌握判断更新中');
    expect(node).toHaveClass('mastery-pending');
    expect(screen.getByText('…')).toBeInTheDocument();
    expect(screen.queryByText('12%')).not.toBeInTheDocument();
  });

  it('uses mastery level rather than retest state for recommended sync graph labels', () => {
    render(
      <ChapterKnowledgeGraph
        kps={[kp({ id: 'kp-retest', name: '速度' })]}
        recommendedKpId="kp-retest"
        masteryJudgments={{
          'kp-retest': judgment({
            kpId: 'kp-retest',
            kpName: '速度',
            masteryLevel: 'stable',
            interventionStatus: 'awaiting_retest',
            nextAction: 'retest',
          }),
        }}
        onOpenKp={vi.fn()}
      />,
    );

    expect(screen.getByText('推荐 · 较稳定')).toBeInTheDocument();
    expect(screen.getByTitle(/推荐 · 较稳定/)).toBeInTheDocument();
    expect(screen.queryByText('待复测')).not.toBeInTheDocument();
  });

  it('uses mastery level rather than improvement state for recommended sync graph labels', () => {
    render(
      <ChapterKnowledgeGraph
        kps={[kp({ id: 'kp-improve', name: '加速度' })]}
        recommendedKpId="kp-improve"
        masteryJudgments={{
          'kp-improve': judgment({
            kpId: 'kp-improve',
            kpName: '加速度',
            masteryLevel: 'developing',
            interventionStatus: 'in_improvement',
            nextAction: 'continue_improvement',
          }),
        }}
        onOpenKp={vi.fn()}
      />,
    );

    expect(screen.getByText('推荐 · 发展中')).toBeInTheDocument();
    expect(screen.getByTitle(/推荐 · 发展中/)).toBeInTheDocument();
    expect(screen.queryByText('提升中')).not.toBeInTheDocument();
  });

  it('shows low-confidence weak judgments as limited evidence', () => {
    render(
      <ChapterKnowledgeGraph
        kps={[kp({ id: 'kp-low', name: '位移', mastery: 0 })]}
        recommendedKpId="kp-low"
        masteryJudgments={{
          'kp-low': judgment({
            kpId: 'kp-low',
            kpName: '位移',
            masteryScore: 0,
            confidence: 'low',
            masteryLevel: 'weak',
            interventionStatus: 'needs_learning',
          }),
        }}
        onOpenKp={vi.fn()}
      />,
    );

    expect(screen.getByText('证据较少')).toBeInTheDocument();
    expect(screen.queryByText('薄弱')).not.toBeInTheDocument();
    expect(screen.getByTitle(/位移/)).toHaveClass('mastery-weak');
  });

  it('keeps the embedded chapter graph canvas compact for a full chapter', () => {
    const { container } = render(
      <ChapterKnowledgeGraph
        kps={Array.from({ length: 13 }, (_, index) => kp({
          id: `kp-${index + 1}`,
          name: `知识点 ${index + 1}`,
          section: `1.${Math.floor(index / 3) + 1} 小节`,
        }))}
        onOpenKp={vi.fn()}
      />,
    );

    const network = container.querySelector('.sync-graph-network') as HTMLElement | null;

    expect(network).not.toBeNull();
    expect(network?.style.height).toBe('426px');
  });
});
