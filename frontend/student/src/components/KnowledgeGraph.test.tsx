import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DirectoryKpNode } from '../types';
import KnowledgeGraph from './KnowledgeGraph';

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

describe('KnowledgeGraph learning state source', () => {
  it('uses backend learning state label instead of raw path status', () => {
    render(
      <KnowledgeGraph
        kps={[kp({
          learning_state: 'practice',
          learning_state_label: '待巩固',
          learning_state_tone: 'practice',
        })]}
        relations={[]}
        onSelectKp={vi.fn()}
      />,
    );

    expect(screen.getByText('待巩固')).toBeInTheDocument();
    expect(screen.queryByText('待学习')).not.toBeInTheDocument();
  });
});
