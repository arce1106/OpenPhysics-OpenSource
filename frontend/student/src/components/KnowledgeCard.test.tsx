import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KnowledgeCard from './KnowledgeCard';
import { api } from '../api/client';
import type { KnowledgeCard as KnowledgeCardType } from '../types';

vi.mock('../api/client', () => ({
  api: {
    markLearnComplete: vi.fn(),
  },
}));

const card: KnowledgeCardType = {
  content_id: 'card-1',
  kp_id: 'kp-1',
  kp_name: '测试知识点',
  title: '测试卡片',
  source: 'test',
  consumed: false,
  sections: [
    {
      type: 'concept',
      title: '概念',
      content: { html: '这是一个知识点' },
    },
  ],
};

describe('KnowledgeCard', () => {
  beforeEach(() => {
    vi.mocked(api.markLearnComplete).mockReset();
  });

  it('does not mark the card consumed when completion sync fails', async () => {
    vi.mocked(api.markLearnComplete).mockRejectedValue(new Error('同步失败'));

    render(<KnowledgeCard card={card} onConsumed={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: '我已理解' }));

    expect(await screen.findByText('同步失败')).toBeInTheDocument();
    expect(screen.queryByText('✓ 已理解')).not.toBeInTheDocument();
  });
});
