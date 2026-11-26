import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { getStudentProfile, setStudentSession } from '../api/studentIdentity';
import StudentClasses from './StudentClasses';

vi.mock('../api/client', () => ({ api: { getMyClasses: vi.fn(), previewClassInvitation: vi.fn(), joinClass: vi.fn(), leaveClass: vi.fn(), renameStudent: vi.fn() } }));
const cls = { id: 'class-test', name: '高一测试班', grade: '高一', teacher_name: '测试老师', student_number: '2', archived: false, teacher_active: true };
const preview = { ...cls, already_joined: false, disclosure: '加入后老师可查看练习记录和掌握情况；不会自动授权第三方 AI。', disclosure_version: 'v1' };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  setStudentSession('test-token', { id: 'test', username: 'test', display_name: '测试学生', status: 'active' });
  vi.mocked(api.getMyClasses).mockResolvedValue([]);
  vi.mocked(api.previewClassInvitation).mockResolvedValue(preview);
  vi.mocked(api.joinClass).mockResolvedValue({ ...cls, added: true, student_name: '张三' });
  vi.mocked(api.leaveClass).mockResolvedValue();
});
async function openJoin() {
  render(<StudentClasses onBusy={vi.fn()} />);
  expect(api.getMyClasses).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '管理' }));
  await screen.findByText('你还没有加入班级。');
  await userEvent.click(screen.getByRole('button', { name: '加入班级' }));
  await userEvent.type(screen.getByLabelText('班级邀请码'), 'abcd2345');
  await userEvent.click(screen.getByRole('button', { name: '查看班级' }));
  await screen.findByText('高一测试班');
  await userEvent.type(screen.getByLabelText('学生姓名'), ' 张三 ');
}
it('changing the code invalidates the preview and cannot join a different class accidentally', async () => {
  await openJoin();
  await userEvent.clear(screen.getByLabelText('班级邀请码'));
  expect(screen.queryByRole('button', { name: '同意并加入' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看班级' })).toBeDisabled();
});
it('requires a student name and displays the current account before confirmation', async () => {
  await openJoin();
  expect(screen.getByText('账号：test')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('学生姓名'));
  expect(screen.getByRole('button', { name: '同意并加入' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('学生姓名'), '   ');
  expect(screen.getByRole('button', { name: '同意并加入' })).toBeDisabled();
  expect(api.joinClass).not.toHaveBeenCalled();
});
it('invalid and expired codes stay editable and show the server error', async () => {
  vi.mocked(api.previewClassInvitation).mockRejectedValue(new Error('邀请码无效或已过期'));
  render(<StudentClasses onBusy={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '管理' }));
  await screen.findByText('你还没有加入班级。');
  await userEvent.click(screen.getByRole('button', { name: '加入班级' }));
  await userEvent.type(screen.getByLabelText('班级邀请码'), '2345ABCD');
  await userEvent.click(screen.getByRole('button', { name: '查看班级' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('邀请码无效或已过期');
  expect(screen.getByLabelText('班级邀请码')).toBeEnabled();
});
it('lets students choose which class to leave from the shared action and supports cancellation', async () => {
  vi.mocked(api.getMyClasses).mockResolvedValue([cls, { ...cls, id: 'second', name: '第二个班' }]);
  render(<StudentClasses onBusy={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '管理' }));
  await screen.findByText('高一测试班');
  expect(screen.queryByRole('button', { name: '退出' })).not.toBeInTheDocument();
  expect(screen.queryByText('填写老师的邀请码，加入班级')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '加入班级' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '刷新班级' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^退出班级$/ }));
  expect(screen.getByRole('button', { name: '确认退出' })).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText('选择班级'), 'class-test');
  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(api.leaveClass).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /^退出班级$/ }));
  await userEvent.selectOptions(screen.getByLabelText('选择班级'), 'class-test');
  await userEvent.click(screen.getByRole('button', { name: '确认退出' }));
  expect(api.leaveClass).toHaveBeenCalledExactlyOnceWith('class-test');
  expect(await screen.findByRole('status')).toHaveTextContent('已退出 高一测试班');
  expect(screen.queryByText('高一测试班')).not.toBeInTheDocument();
  expect(screen.getByText('第二个班')).toBeInTheDocument();
});
it('blocks repeated joins while waiting and ignores responses after the session changes', async () => {
  let resolve!: (value: typeof cls & { added: boolean; student_name: string }) => void;
  vi.mocked(api.joinClass).mockImplementation(() => new Promise(done => { resolve = done; }));
  await openJoin();
  await userEvent.dblClick(screen.getByRole('button', { name: '同意并加入' }));
  expect(api.joinClass).toHaveBeenCalledTimes(1);
  setStudentSession('another-token', { id: 'other', username: 'other', display_name: '另一个人', status: 'active' });
  resolve({ ...cls, added: true, student_name: '张三' });
  await waitFor(() => expect(screen.queryByText('正在处理…')).not.toBeInTheDocument());
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByText('测试老师 · 学号 2')).not.toBeInTheDocument();
});

it('a student corrects the name their teachers see', async () => {
  vi.mocked(api.getMyClasses).mockResolvedValue([cls]);
  vi.mocked(api.renameStudent).mockResolvedValue({ student_name: '张三' });
  render(<StudentClasses onBusy={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '管理' }));
  await userEvent.click(await screen.findByRole('button', { name: '修改姓名' }));
  const input = screen.getByLabelText('学生姓名');
  expect(input).toHaveValue('测试学生');
  await userEvent.clear(input);
  await userEvent.type(input, '张三');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(api.renameStudent).toHaveBeenCalledWith('张三');
  expect(await screen.findByText('老师看到的姓名已改为 张三。')).toBeInTheDocument();
  expect(getStudentProfile()?.display_name).toBe('张三');
});
