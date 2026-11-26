import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api/client';
import { LoginPage } from './App';

describe('admin login', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('requires both account and password', async () => {
    render(<LoginPage onLogin={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(screen.getByText('请输入管理员账号和密码')).toBeInTheDocument();
  });

  it('stores a successful login and reports the username', async () => {
    const onLogin = vi.fn();
    vi.spyOn(api, 'loginAdmin').mockResolvedValue({
      access_token: 'admin-token',
      token_type: 'bearer',
      username: 'admin',
    });
    render(<LoginPage onLogin={onLogin} />);

    await userEvent.type(screen.getByLabelText('账号'), 'admin');
    await userEvent.type(screen.getByLabelText('密码'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(onLogin).toHaveBeenCalledWith('admin', 'admin-token');
    expect(window.localStorage.getItem('openphysics_admin_token')).toBe('admin-token');
  });
});
