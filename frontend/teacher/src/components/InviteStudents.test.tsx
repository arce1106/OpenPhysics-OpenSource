import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import InviteStudents from './InviteStudents';

vi.mock('../api', () => ({ api: { classInvitation: vi.fn(), generateClassInvitation: vi.fn(), disableClassInvitation: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.classInvitation).mockResolvedValue({ code: null, enabled: false, expires_at: null });
  vi.mocked(api.generateClassInvitation).mockResolvedValue({ code: 'ABCD2345', enabled: true, expires_at: '2026-11-02T12:00:00Z' });
  vi.mocked(api.disableClassInvitation).mockResolvedValue({ code: null, enabled: false, expires_at: null });
});
it('opens from class, generates, copies, rotates and stops the invitation', async () => {
  render(<InviteStudents classId="class-test" className="测试班" />);
  await userEvent.click(screen.getByRole('button', { name: '邀请学生' }));
  expect(await screen.findByText('当前未开放邀请。')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '生成邀请码' }));
  expect(await screen.findByLabelText('班级邀请码')).toHaveTextContent('ABCD2345');
  expect(api.generateClassInvitation).toHaveBeenCalledWith('class-test');
  await userEvent.click(screen.getByRole('button', { name: '复制邀请码' }));
  await userEvent.click(screen.getByRole('button', { name: '重新生成邀请码' }));
  expect(api.generateClassInvitation).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole('button', { name: '停止邀请' }));
  await waitFor(() => expect(screen.queryByLabelText('班级邀请码')).not.toBeInTheDocument());
  expect(api.disableClassInvitation).toHaveBeenCalledWith('class-test');
  await userEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '邀请学生' })).toHaveFocus();
});
it('shows a recoverable load error without generating a code', async () => {
  vi.mocked(api.classInvitation).mockRejectedValueOnce(new Error('暂时无法读取'));
  render(<InviteStudents classId="class-test" className="测试班" />);
  await userEvent.click(screen.getByRole('button', { name: '邀请学生' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取');
  expect(api.generateClassInvitation).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('当前未开放邀请。')).toBeInTheDocument();
});
