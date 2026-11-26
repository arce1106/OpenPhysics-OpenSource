import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import StudentAccountMenu from './StudentAccountMenu';

function setup() {
  const onLogout = vi.fn(), onNavigate = vi.fn();
  render(<MemoryRouter><StudentAccountMenu name="演示学习者" onLogout={onLogout} onNavigate={onNavigate} />
    <button>其他操作</button><Routes><Route path="/profile" element={<h1>个人中心页面</h1>} /></Routes>
  </MemoryRouter>);
  return { user: userEvent.setup(), onLogout, onNavigate };
}
describe('Student account disclosure', () => {
  it('only shows the name until clicked and then groups personal center and logout', async () => {
    const { user, onLogout } = setup();
    const trigger = screen.getByRole('button', { name: '演示学习者' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '退出' })).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByRole('link', { name: '个人中心' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('button', { name: '退出' })).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByRole('group', { name: '账户选项' })).not.toBeInTheDocument();
    expect(onLogout).not.toHaveBeenCalled();
  });
  it('closes outside, on Escape with focus restored, and when tabbing out', async () => {
    const { user } = setup();
    const trigger = screen.getByRole('button', { name: '演示学习者' });
    await user.click(trigger); await user.click(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger); await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus(); expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}'); await user.tab();
    expect(screen.getByRole('link', { name: '个人中心' })).toHaveFocus();
    await user.tab(); expect(screen.getByRole('button', { name: '退出' })).toHaveFocus();
    await user.tab(); expect(screen.getByRole('button', { name: '其他操作' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
  it('navigates and closes without logging out', async () => {
    const { user, onLogout, onNavigate } = setup();
    await user.click(screen.getByRole('button', { name: '演示学习者' }));
    await user.click(screen.getByRole('link', { name: '个人中心' }));
    expect(screen.getByRole('heading', { name: '个人中心页面' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '账户选项' })).not.toBeInTheDocument();
    expect(onNavigate).toHaveBeenCalledOnce(); expect(onLogout).not.toHaveBeenCalled();
  });
  it('only invokes existing logout after choosing exit', async () => {
    const { user, onLogout } = setup();
    await user.click(screen.getByRole('button', { name: '演示学习者' }));
    await user.click(screen.getByRole('button', { name: '退出' }));
    expect(onLogout).toHaveBeenCalledOnce();
    expect(screen.queryByRole('group', { name: '账户选项' })).not.toBeInTheDocument();
  });
});
