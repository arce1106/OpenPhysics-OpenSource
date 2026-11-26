import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DirectoryKpNode } from '../../types';
import CurriculumNavigator from './CurriculumNavigator';

function kp(overrides: Partial<DirectoryKpNode>): DirectoryKpNode {
  return {
    id: 'kp',
    name: '平抛运动实验思想',
    volume: '必修 第二册',
    chapter: '第五章 抛体运动',
    section: '5.3',
    mastery: 0,
    status: 'needs_learning',
    blocked_by: [],
    last_practiced: null,
    ...overrides,
  } as DirectoryKpNode;
}

describe('CurriculumNavigator learning state source', () => {
  it('shows backend practice state even when mastery is still zero', () => {
    render(
      <CurriculumNavigator
        kps={[kp({
          learning_state: 'practice',
          learning_state_label: '待巩固',
          learning_state_tone: 'practice',
        })]}
        onSelectChapter={vi.fn()}
      />,
    );

    expect(screen.getByText('待巩固')).toBeInTheDocument();
  });

  it('does not infer consolidation from untouched needs-learning knowledge points', () => {
    render(
      <CurriculumNavigator
        kps={[kp({
          learning_state: 'to_learn',
          learning_state_label: '待学习',
          learning_state_tone: 'learning',
        })]}
        onSelectChapter={vi.fn()}
      />,
    );

    expect(screen.getByText('待学习')).toBeInTheDocument();
    expect(screen.queryByText('待巩固')).not.toBeInTheDocument();
  });
});
