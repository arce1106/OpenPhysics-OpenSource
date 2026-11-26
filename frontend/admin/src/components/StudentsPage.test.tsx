import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { Student } from '../types';
import StudentsPage from './StudentsPage';

const student: Student = {
  id: 'stu-1',
  username: 'student001',
  display_name: '测试学生',
  class_name: '高一1班',
  status: 'active',




  account_source: 'admin',
};

describe('StudentsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listStudents').mockResolvedValue([student]);
  });

  it('keeps browsers from autofilling admin credentials into the new-student form', async () => {
    render(<StudentsPage />);
    await screen.findByText('student001');

    const form = screen.getByLabelText('新学生账号').closest('form');
    expect(form).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('新学生账号')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('新学生班级')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('新学生初始密码')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('rejects an initial password shorter than six characters', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(api, 'createStudent');
    render(<StudentsPage />);
    await screen.findByText('student001');

    await user.type(screen.getByLabelText('新学生账号'), 'new001');
    await user.type(screen.getByLabelText('新学生初始密码'), '123');
    await user.click(screen.getByRole('button', { name: '创建学生' }));

    expect(screen.getByText('初始密码至少 6 位')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('requires typing RESET before clearing learning data', async () => {
    const user = userEvent.setup();
    const reset = vi.spyOn(api, 'resetStudentAccount').mockResolvedValue({
      reset: true, student, deleted: { answers: 3, mastery: 2 },
    });
    render(<StudentsPage />);
    await user.click(await screen.findByRole('button', { name: '重置账号' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: '清空并重置' });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/RESET/), 'RESET');
    await user.click(confirm);

    expect(reset).toHaveBeenCalledWith('stu-1');
    expect(await screen.findByText(/清理 5 条学习数据/)).toBeInTheDocument();
  });

  it('filters the list by keyword', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listStudents').mockResolvedValue([
      student,
      { ...student, id: 'stu-2', username: 'other002', display_name: '另一位', class_name: '高二3班' },
    ]);
    render(<StudentsPage />);
    await screen.findByText('other002');

    await user.type(screen.getByLabelText('搜索学生'), '高二');

    expect(screen.queryByText('student001')).not.toBeInTheDocument();
    expect(screen.getByText('other002')).toBeInTheDocument();
    expect(screen.getByText('匹配 1 / 2 人')).toBeInTheDocument();
  });
});
