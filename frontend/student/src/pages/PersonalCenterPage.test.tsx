import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { getStudentToken, setStudentSession } from '../api/studentIdentity';
import PersonalCenterPage from './PersonalCenterPage';

vi.mock('../api/client', () => ({ api: { getAccountCredentials: vi.fn(), getAuthCapabilities: vi.fn(), getCaptcha: vi.fn(), securityRequest: vi.fn() } }));
const settings = { username: '演示学习者', masked_phone: null, has_password: true, username_change_limit: 3,
  username_change_window_days: 365, username_changes_remaining: 3, username_next_change_at: null };
const profile = { id: 'synthetic', username: settings.username, display_name: '学校姓名', status: 'active' };
function Location() { return <div data-testid="location">{useLocation().pathname}</div>; }
function mount() { return render(<MemoryRouter initialEntries={['/profile']}><Location /><Routes><Route path="/profile" element={<PersonalCenterPage />} /><Route path="/login" element={<p>重新登录</p>} /></Routes></MemoryRouter>); }
async function passwordForm() {
  await userEvent.click(await screen.findByRole('button', { name: '修改密码' }));
  await userEvent.type(screen.getByLabelText('原密码'), 'old-password');
  await userEvent.type(screen.getByLabelText('新密码', { exact: true }), 'new-password');
  await userEvent.type(screen.getByLabelText('确认新密码'), 'new-password');
}
describe('Inline personal center', () => {
  beforeEach(() => {
    vi.restoreAllMocks(); vi.resetAllMocks(); localStorage.clear();
    setStudentSession('old-token', profile);
    vi.mocked(api.getAccountCredentials).mockResolvedValue(settings);
    vi.mocked(api.getCaptcha).mockResolvedValue({ challenge_id: 'test', image_base64: 'data:image/png;base64,', expires_in_seconds: 300 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  it('has two compact rows and no navigation when switching editors', async () => {
    mount();
    expect(await screen.findByText('演示学习者')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '修改用户名' }));
    expect(screen.getByLabelText('新用户名')).toHaveFocus();
    expect(screen.queryByLabelText('原密码')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.queryByLabelText('新用户名')).not.toBeInTheDocument();
    expect(screen.getByLabelText('原密码')).toHaveFocus();
    expect(screen.getByTestId('location')).toHaveTextContent('/profile');
    expect(api.getCaptcha).not.toHaveBeenCalled();
  });
  it('does not discard edits without confirmation and clears cancelled secrets', async () => {
    mount(); await passwordForm();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole('button', { name: '修改用户名' }));
    expect(screen.getByLabelText('原密码')).toHaveValue('old-password');
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    await userEvent.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByLabelText('原密码')).toHaveValue('');
  });
  it('preserves a rejected form and does not renew on a validation error', async () => {
    vi.mocked(api.securityRequest).mockRejectedValue(Object.assign(new Error('原密码不正确'), { status: 400 }));
    mount(); await passwordForm();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('原密码不正确');
    expect(screen.getByLabelText('新密码', { exact: true })).toHaveValue('new-password');
    expect(getStudentToken()).toBe('old-token');
  });
  it('requires re-login when a successful mutation lacks replacement credentials', async () => {
    vi.mocked(api.securityRequest).mockResolvedValue({ changed: true });
    mount(); await passwordForm();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(getStudentToken()).toBe(''));
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });
  it('ignores a late save response after switching accounts', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api.securityRequest).mockReturnValue(new Promise(value => { resolve = value; }));
    mount(); await passwordForm();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    setStudentSession('other-token', { ...profile, id: 'other' });
    resolve({ changed: true, access_token: 'late-token', student: profile, settings });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    expect(getStudentToken()).toBe('other-token');
  });
  it('offers a retry after an account read failure', async () => {
    vi.mocked(api.getAccountCredentials).mockRejectedValueOnce(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取账号设置');
    await userEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('演示学习者')).toBeInTheDocument();
  });
  it('validates changed usernames and submits no password fields for passwordless renaming', async () => {
    vi.mocked(api.getAccountCredentials).mockResolvedValue({ ...settings, has_password: false, masked_phone: '199****0001' });
    vi.mocked(api.securityRequest).mockResolvedValue({ changed: true, access_token: 'new-token', student: { ...profile, username: 'new_name' }, settings: { ...settings, username: 'new_name' } });
    mount(); await userEvent.click(await screen.findByRole('button', { name: '修改用户名' }));
    const input = screen.getByLabelText('新用户名');
    await userEvent.clear(input); await userEvent.type(input, '19999990001');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('不能为纯数字');
    expect(api.securityRequest).not.toHaveBeenCalled();
    await userEvent.clear(input); await userEvent.type(input, 'new_name');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(api.securityRequest).toHaveBeenCalledWith('account-credentials', { renew_session: true, username: 'new_name' });
  });
  it('accepts Chinese usernames but rejects more than eight Chinese characters without a password', async () => {
    vi.mocked(api.securityRequest).mockResolvedValue({ changed: true, access_token: 'new-token', student: { ...profile, username: '物理小达人' }, settings: { ...settings, username: '物理小达人' } });
    mount(); await userEvent.click(await screen.findByRole('button', { name: '修改用户名' }));
    const input = screen.getByLabelText('新用户名');
    await userEvent.clear(input); await userEvent.type(input, '一二三四五六七八九');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('中文2—8字');
    expect(api.securityRequest).not.toHaveBeenCalled();
    await userEvent.clear(input); await userEvent.type(input, '物理小达人');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(api.securityRequest).toHaveBeenCalledWith('account-credentials', { renew_session: true, username: '物理小达人' });
  });
  it('does not submit mismatched passwords', async () => {
    mount(); await passwordForm();
    await userEvent.type(screen.getByLabelText('确认新密码'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('两次输入必须一致');
    expect(api.securityRequest).not.toHaveBeenCalled();
  });
  it('blocks duplicate saves while a response is pending', async () => {
    vi.mocked(api.securityRequest).mockReturnValue(new Promise(() => {}));
    mount(); await passwordForm();
    await userEvent.dblClick(screen.getByRole('button', { name: '保存' }));
    expect(api.securityRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '修改用户名' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  });
  it('limits only renaming when the annual quota is exhausted', async () => {
    vi.mocked(api.getAccountCredentials).mockResolvedValue({ ...settings, username_changes_remaining: 0, username_next_change_at: '2027-09-08T12:00:00Z' });
    mount(); await userEvent.click(await screen.findByRole('button', { name: '修改用户名' }));
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByText(/下次可修改/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });
  it('renames a password-protected school account without requesting or submitting a password', async () => {
    vi.mocked(api.securityRequest).mockResolvedValue({ changed: true, access_token: 'new-token', student: { ...profile, username: 'new_school_name' }, settings: { ...settings, username: 'new_school_name', username_changes_remaining: 2 } });
    mount(); await userEvent.click(await screen.findByRole('button', { name: '修改用户名' }));
    expect(screen.queryByLabelText('原密码')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('新用户名'));
    await userEvent.type(screen.getByLabelText('新用户名'), 'new_school_name');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(api.securityRequest).toHaveBeenCalledWith('account-credentials', { renew_session: true, username: 'new_school_name' });
    expect(getStudentToken()).toBe('new-token');
    expect(await screen.findByText('new_school_name')).toBeInTheDocument();
    expect(api.getCaptcha).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '修改用户名' }));
    expect(screen.getByText(/还可修改2次/)).toBeInTheDocument();
  });
});
