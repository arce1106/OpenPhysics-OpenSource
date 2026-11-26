import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssignDialog from './AssignDialog';

const classes = [{ id: 'c_1', name: '高三（7）', grade: '高三', level: 'standard' as const, archived: false, member_count: 2 }];

test('a test selects whole classes in the floating picker and sends one mutually exclusive delivery mode', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(init?.method === 'POST' ? { assigned: [] } : { ...classes[0], members: [
      { id: 'alice', display_name: 'Alice', status: 'active', student_number: '1' },
      { id: 'bob', display_name: 'Bob', status: 'active', student_number: '2' },
    ] }));
  });
  const done = vi.fn();
  render(<AssignDialog assignmentId="paper_1" title="单元测验" kind="test" assigned={[]} classes={classes}
    onClose={vi.fn()} onDone={done} />);
  expect(screen.queryByRole('button', { name: '指定学生' })).toBeNull();
  const trigger = screen.getByRole('button', { name: '选择班级' });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('checkbox', { name: '高三（7）' }));
  expect(screen.queryByRole('button', { name: '展开高三（7）学生' })).toBeNull();
  expect(calls.some((call) => call.url.endsWith('/classes/c_1'))).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(trigger).toHaveTextContent('全班 2 人');
  expect(screen.getByRole('radio', { name: '打印' })).toBeChecked();
  await userEvent.click(screen.getByRole('radio', { name: '推送 App' }));
  expect(screen.getByRole('radio', { name: '打印' })).not.toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: '发布给 1 个班' }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(calls.find((call) => call.url.endsWith('/assign'))?.body).toEqual({
    class_ids: ['c_1'], delivery: 'app',
  });
});

test('Escape closes only the floating picker before closing the assignment dialog', async () => {
  const close = vi.fn();
  render(<AssignDialog assignmentId="paper_1" title="个性化作业" kind="personalized" assigned={[]} classes={classes}
    onClose={close} onDone={vi.fn()} />);
  const trigger = screen.getByRole('button', { name: '选择班级和学生' });
  await userEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: '选择班级学生' })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: '选择班级学生' })).toBeNull();
  expect(screen.getByRole('dialog', { name: '布置到班级' })).toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(close).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  expect(close).toHaveBeenCalledTimes(1);
});

test('App delivery says who will get paper instead and who cannot submit written answers', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ...classes[0], members: [
    { id: 'alice', display_name: 'Alice', status: 'active', student_number: '1', last_login_at: '2026-10-20T00:00:00Z', app_ai_declined: true },
    { id: 'bob', display_name: 'Bob', status: 'active', student_number: '2', last_login_at: null },
  ] })));
  render(<AssignDialog assignmentId="paper_1" title="单元测验" kind="test" assigned={[]} classes={classes}
    preselected={['c_1']} onClose={vi.fn()} onDone={vi.fn()} />);
  expect(screen.queryByRole('note')).toBeNull();
  await userEvent.click(screen.getByRole('radio', { name: '推送 App' }));
  const note = await screen.findByRole('note');
  expect(note).toHaveTextContent('Bob还没有登录过 App 或网页，会自动改为纸质');
  expect(note).toHaveTextContent('Alice已在 iOS App 拒绝 AI 批改');
});
