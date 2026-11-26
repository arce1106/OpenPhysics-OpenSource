import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LoginPage from './LoginPage';
import { api } from '../api/client';
vi.mock('../api/client', () => ({ api: { login: vi.fn(), getCaptcha: vi.fn() } }));
vi.mock('../api/studentIdentity', () => ({ getStudentToken: () => null }));
vi.mock('../utils/capacitorShell', () => ({ isCapacitorShell: () => false }));
function open() { return render(<MemoryRouter initialEntries={['/login']}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/" element={<h1>学习首页</h1>} /></Routes></MemoryRouter>); }
function fill() { fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'student' } }); fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } }); }
describe('self-hosted password login', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('shows account/password login and administrator recovery without phone registration', () => {
    open(); expect(screen.getByRole('button', { name: '登录' })).toBeDisabled();
    expect(screen.getByText(/联系本部署的管理员/)).toBeInTheDocument();
    expect(screen.queryByText('手机验证码登录')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '注册' })).not.toBeInTheDocument();
  });
  it('logs in with a password and reaches the requested app', async () => {
    vi.mocked(api.login).mockResolvedValue({} as never); open(); fill(); fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('heading', { name: '学习首页' })).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith('student', 'secret123', undefined);
  });
  it('keeps the page and reports failed credentials', async () => {
    vi.mocked(api.login).mockRejectedValue(new Error('用户名或密码错误')); open(); fill(); fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码错误');
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled();
  });
  it('requires the fresh captcha after repeated login failures', async () => {
    vi.mocked(api.login).mockRejectedValueOnce(Object.assign(new Error('需要图形验证码'), { captchaRequired: true }));
    vi.mocked(api.getCaptcha).mockResolvedValue({ challenge_id: 'fresh', image_base64: 'data:image/png;base64,eA==' } as never);
    open(); fill(); fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await screen.findByRole('img', { name: '图形验证码' });
    expect(screen.getByRole('button', { name: '登录' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('图形验证码'), { target: { value: 'ABCD' } });
    vi.mocked(api.login).mockRejectedValueOnce(new Error('验证码错误'));
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(api.login).toHaveBeenLastCalledWith('student', 'secret123', { captcha_id: 'fresh', captcha_answer: 'ABCD' }));
  });
});
