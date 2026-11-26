import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import AITutorChat from './AITutorChat';

describe('AITutorChat', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('uses the same composer and send icon treatment as the question tutor', () => {
    render(<AITutorChat kpId="kp-motion" kpName="运动学" />);

    expect(screen.queryByRole('dialog', { name: 'AI助教 · 当前知识点' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开AI助教' })).toBeInTheDocument();
  });

  it('opens a floating current-knowledge assistant with learning prompts', async () => {
    render(<AITutorChat kpId="kp-motion" kpName="运动学" />);

    await userEvent.click(screen.getByRole('button', { name: '打开AI助教' }));

    expect(screen.getByRole('dialog', { name: 'AI助教 · 当前知识点' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '这个知识点怎么理解？' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '换一种说法讲' })).toBeInTheDocument();
    const input = screen.getByLabelText('输入当前知识点的问题');
    const send = screen.getByRole('button', { name: '发送' });

    expect(document.querySelector('.question-tutor-composer')).not.toBeNull();
    expect(input).toHaveClass('question-tutor-input');
    expect(send).toHaveClass('question-tutor-send');
    expect(send.querySelector('svg')).not.toBeNull();
  });
});
