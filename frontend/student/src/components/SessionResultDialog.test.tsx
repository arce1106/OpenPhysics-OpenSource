import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SessionResultDialog from './SessionResultDialog';

describe('SessionResultDialog', () => {
  it('keeps the question page mounted while showing and closing a compact result', async () => {
    const onClose = vi.fn();
    render(
      <div>
        <div>当前题目仍然可见</div>
        <SessionResultDialog
          open
          title="评估结果"
          scoreText="正确 2/3"
          label="有基础，需巩固"
          feedback="建议继续完成一组巩固练习。"
          actions={<button type="button">做巩固小练</button>}
          onClose={onClose}
        />
      </div>,
    );

    expect(screen.getByText('当前题目仍然可见')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '评估结果' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '关闭结果' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from Escape without activating result actions', () => {
    const onClose = vi.fn();
    const onAction = vi.fn();
    render(
      <SessionResultDialog
        open
        title="练习结果"
        scoreText="得分 3/3"
        label="本轮方法稳定"
        feedback="可以继续下一步。"
        actions={<button type="button" onClick={onAction}>继续下一步</button>}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });
});
