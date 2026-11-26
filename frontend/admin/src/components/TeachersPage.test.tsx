import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { AdminTeacher } from '../types';
import TeachersPage from './TeachersPage';

const teacher: AdminTeacher = {
  id: 't_1',
  username: 'wang',
  display_name: '王老师',
  status: 'active',
  must_change_password: true,
  last_login_at: null,
  created_at: '2026-10-21T00:00:00Z',
  classes: [{
    id: 'c_1',
    teacher_id: 't_1',
    name: '高一(3)班',
    grade: '高一',
    level: 'advanced',
    archived: false,
    member_count: 0,
  }],
};

describe('TeachersPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listTeachers').mockResolvedValue([teacher]);
  });

  it('creates a teacher without letting browsers autofill admin credentials', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(api, 'createTeacher').mockResolvedValue({
      ...teacher, id: 't_2', username: 'li', display_name: '李老师', classes: [],
    });
    render(<TeachersPage />);
    await screen.findByText('王老师');

    expect(screen.getByLabelText('新教师用户名').closest('form')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('新教师初始密码')).toHaveAttribute('autocomplete', 'new-password');

    await user.type(screen.getByLabelText('新教师用户名'), ' li ');
    await user.type(screen.getByLabelText('新教师姓名'), '李老师');
    await user.type(screen.getByLabelText('新教师初始密码'), 'init2026pass');
    await user.click(screen.getByRole('button', { name: '创建教师' }));

    expect(create).toHaveBeenCalledWith({ username: 'li', display_name: '李老师', password: 'init2026pass' });
    expect(await screen.findByText('已创建教师 李老师，首次登录需修改初始密码')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '教师 李老师' })).toBeInTheDocument();
  });

  it('shows class level and pending password change', async () => {
    render(<TeachersPage />);
    const card = await screen.findByRole('region', { name: '教师 王老师' });
    expect(within(card).getByText('待修改初始密码')).toBeInTheDocument();
    expect(within(card).getByText('高一 · 实验班 · 0 名学生')).toBeInTheDocument();
  });

  it('adds an existing student to a class and updates the count', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listClassMembers').mockResolvedValue([]);
    const add = vi.spyOn(api, 'addClassMember').mockResolvedValue({
      member: { id: 's_1', username: 'alice_s', display_name: 'Alice', status: 'active' },
      added: true,
    });
    render(<TeachersPage />);
    await user.click(await screen.findByRole('button', { name: '管理学生' }));
    await screen.findByText('班级里还没有学生。');

    await user.type(screen.getByLabelText('加入 高一(3)班 的学生用户名'), 'alice_s');
    await user.selectOptions(screen.getByLabelText('入班授权方'), 'guardian');
    await user.click(screen.getByRole('button', { name: '加入班级' }));

    expect(add).toHaveBeenCalledWith('c_1', 'alice_s', 'guardian');
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('高一 · 实验班 · 1 名学生')).toBeInTheDocument();
  });

  it('shows the server error when the student account does not exist', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listClassMembers').mockResolvedValue([]);
    vi.spyOn(api, 'addClassMember').mockRejectedValue(new Error('没有这个学生账号'));
    render(<TeachersPage />);
    await user.click(await screen.findByRole('button', { name: '管理学生' }));
    await screen.findByText('班级里还没有学生。');

    await user.type(screen.getByLabelText('加入 高一(3)班 的学生用户名'), 'nobody');
    await user.click(screen.getByRole('button', { name: '加入班级' }));

    expect(await screen.findByText('没有这个学生账号')).toBeInTheDocument();
  });

  it('confirms before disabling a teacher', async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(api, 'updateTeacher').mockResolvedValue({ ...teacher, status: 'disabled' });
    render(<TeachersPage />);
    await user.click(await screen.findByRole('button', { name: '停用' }));
    expect(update).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '停用' }));

    expect(update).toHaveBeenCalledWith('t_1', { status: 'disabled' });
    expect(await screen.findByText('已停用 王老师')).toBeInTheDocument();
  });

  it('records a written AI authorization for the whole class', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listClassMembers').mockResolvedValue([
      { id: 's_1', username: 'alice_s', display_name: 'Alice', status: 'active', teacher_ai_authorized: false },
      { id: 's_2', username: 'bob_s', display_name: 'Bob', status: 'active', teacher_ai_authorized: true, teacher_ai_grantor: 'guardian' },
    ]);
    const record = vi.spyOn(api, 'recordAiAuthorization').mockResolvedValue([
      { id: 's_1', username: 'alice_s', display_name: 'Alice', status: 'active', teacher_ai_authorized: true, teacher_ai_grantor: 'school' },
      { id: 's_2', username: 'bob_s', display_name: 'Bob', status: 'active', teacher_ai_authorized: true, teacher_ai_grantor: 'guardian' },
    ]);
    render(<TeachersPage />);
    await user.click(await screen.findByRole('button', { name: '管理学生' }));
    expect(await screen.findByText(/AI 识别批改授权：1 \/ 2 人/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '登记全班学校书面授权' }));

    expect(record).toHaveBeenCalledWith('c_1', { student_ids: ['s_1'], granted: true, grantor: 'school' });
    expect(await screen.findByText(/AI 识别批改授权：2 \/ 2 人/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤回 Bob 的 AI 授权' })).toBeInTheDocument();
  });
});
