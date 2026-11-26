import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import type { ClassAssignment, ClassHomework, LibraryEntry } from '../types';

const AUTH = {
  access_token: 'ready-token',
  teacher: { id: 't_1', username: 'wang', display_name: '王老师', must_change_password: false },
};

const CLASSES = [
  { id: 'c_1', name: '高一(3)班', grade: '高一', level: 'standard', archived: false, member_count: 2 },
  { id: 'c_2', name: '高一(5)班', grade: '高一', level: 'standard', archived: false, member_count: 1 },
];

function given(id: string, classId: string, extra: Partial<ClassAssignment> = {}): ClassAssignment {
  const name = CLASSES.find((item) => item.id === classId)!.name;
  return { id, class_id: classId, class_name: name, archived: false, status: 'published', created_at: '2026-10-22T08:00:00Z',
    published_at: '2026-10-22T08:00:00Z', results_released_at: null, collected: 0, member_count: 2, ...extra };
}

const TEST: LibraryEntry = {
  id: 'p_1', class_id: null, title: '运动学单元测验', kind: 'test', status: 'saved', question_count: 8, total_points: 44,
  created_at: '2026-10-20T00:00:00Z', published_at: '2026-10-20T08:00:00Z', is_paper: true,
  classes: [given('a_3', 'c_1', { results_released_at: '2026-10-23T00:00:00Z', collected: 2 }), given('a_5', 'c_2')],
};
const HOMEWORK: LibraryEntry = {
  id: 'p_2', class_id: null, title: '第三周个性化作业', kind: 'personalized', status: 'draft', question_count: 6,
  total_points: null, created_at: '2026-10-21T00:00:00Z', published_at: null, is_paper: true,
  classes: [given('a_7', 'c_1', { status: 'draft' })],
};
const UNUSED: LibraryEntry = {
  id: 'p_3', class_id: null, title: '热学检测', kind: 'test', status: 'draft', question_count: 0, total_points: 0,
  created_at: '2026-10-19T00:00:00Z', published_at: null, is_paper: true, classes: [],
};

function mockApi(handlers: Record<string, (init?: RequestInit) => { status?: number; body: unknown }>) {
  const calls: Array<{ key: string; body: unknown }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method || 'GET'} ${url.pathname}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : null });
    const handler = handlers[key];
    if (!handler) return new Response(JSON.stringify({ detail: `unexpected ${key}` }), { status: 500 });
    const result = handler(init);
    return new Response(result.status === 204 ? null : JSON.stringify(result.body), { status: result.status ?? 200 });
  });
  return calls;
}

beforeEach(() => {
  window.localStorage.setItem('openphysics:teacher:auth', JSON.stringify(AUTH));
});

test('作业管理 shows independent workflow entries for each class and keeps unreleased reports unavailable', async () => {
  window.history.pushState({}, '', '/papers');
  const calls = mockApi({
    'GET /api/teacher/assignments': () => ({ body: [TEST, HOMEWORK, UNUSED] }),
    'GET /api/teacher/classes': () => ({ body: CLASSES }),
  });
  render(<App />);

  expect(await screen.findByRole('heading', { name: '作业管理' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '去组卷' })).toHaveAttribute('href', '/');
  const test = await screen.findByRole('listitem', { name: '运动学单元测验' });
  expect(within(test).getByRole('link', { name: '运动学单元测验' })).toHaveAttribute('href', '/assignments/a_3');
  expect(within(test).getByText('8 题 · 44 分 · 保存于 10/20')).toBeInTheDocument();
  expect(within(test).getByRole('button', { name: '下载 PDF' })).toBeEnabled();
  expect(within(test).getByRole('button', { name: '发布到班级' })).toBeInTheDocument();
  expect(within(test).getByRole('link', { name: /高一\(3\)班.*已发布结果/ })).toHaveAttribute('href', '/assignments/a_3');
  expect(within(test).getByRole('link', { name: /高一\(5\)班.*待收卷/ })).toHaveAttribute('href', '/assignments/a_5');
  const releasedFlow = within(test).getByRole('list', { name: '高一(3)班作业流程' });
  expect(within(releasedFlow).getByRole('link', { name: '查看报告' })).toHaveAttribute('href', '/assignments/a_3?tab=overview');
  const pendingFlow = within(test).getByRole('list', { name: '高一(5)班作业流程' });
  expect(within(pendingFlow).getByRole('link', { name: '待收卷' })).toHaveAttribute('href', '/assignments/a_5/collect');
  expect(within(pendingFlow).getByRole('button', { name: '预批与审核' })).toBeDisabled();
  expect(within(pendingFlow).getByRole('button', { name: '学情报告' })).toBeDisabled();
  const homework = screen.getByRole('listitem', { name: '第三周个性化作业' });
  expect(within(homework).getByText('待审核发布')).toBeInTheDocument();
  expect(within(homework).getByRole('button', { name: '按同样设置再布置' })).toBeInTheDocument();
  const draftFlow = within(homework).getByRole('list', { name: '高一(3)班作业流程' });
  expect(within(draftFlow).getByRole('link', { name: '审核并发布' })).toHaveAttribute('href', '/assignments/a_7');
  expect(within(draftFlow).getByRole('button', { name: '待收卷' })).toBeDisabled();
  // A paper not saved yet goes back to 组卷; it cannot be downloaded or published.
  const unsaved = screen.getByRole('listitem', { name: '热学检测' });
  expect(within(unsaved).getByText('未保存')).toBeInTheDocument();
  expect(within(unsaved).getByText('还没保存')).toBeInTheDocument();
  expect(within(unsaved).getByRole('link', { name: '继续组卷' })).toHaveAttribute('href', '/assignments/p_3');
  expect(within(unsaved).queryByRole('button', { name: '下载 PDF' })).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: '个性化作业' }));
  expect(screen.queryByRole('listitem', { name: '运动学单元测验' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '全部' }));
  // A class view keeps that class's homework and papers not yet given to any class.
  await userEvent.selectOptions(screen.getByLabelText('按班级查看'), 'c_2');
  expect(screen.getByRole('listitem', { name: '运动学单元测验' })).toBeInTheDocument();
  expect(screen.queryByRole('listitem', { name: '第三周个性化作业' })).toBeNull();
  expect(screen.getByRole('listitem', { name: '热学检测' })).toBeInTheDocument();
  expect(within(screen.getByRole('listitem', { name: '运动学单元测验' })).queryByRole('list', { name: '高一(3)班作业流程' })).toBeNull();
  expect(calls.map((call) => call.key)).toEqual(['GET /api/teacher/assignments', 'GET /api/teacher/classes']);
});

test('personalized settings are drafted again for another class from the list', async () => {
  window.history.pushState({}, '', '/papers');
  let library = [HOMEWORK];
  const calls = mockApi({
    'GET /api/teacher/assignments': () => ({ body: library }),
    'GET /api/teacher/classes': () => ({ body: CLASSES }),
    'POST /api/teacher/assignments/p_2/assign': () => {
      library = [{ ...HOMEWORK, classes: [...HOMEWORK.classes, given('a_8', 'c_2', { status: 'draft' })] }];
      return { body: { assigned: [{ id: 'a_8' }, { id: 'a_9' }] } };
    },
  });
  render(<App />);

  const row = await screen.findByRole('listitem', { name: '第三周个性化作业' });
  await userEvent.click(within(row).getByRole('button', { name: '按同样设置再布置' }));
  const dialog = screen.getByRole('dialog', { name: '布置到班级' });
  await userEvent.click(within(dialog).getByRole('button', { name: '选择班级和学生' }));
  // Personalized settings may go to a class again.
  expect(within(dialog).getByRole('checkbox', { name: '高一(3)班' })).not.toBeDisabled();
  await userEvent.click(within(dialog).getByRole('checkbox', { name: '高一(5)班' }));
  await userEvent.click(within(dialog).getByRole('checkbox', { name: '高一(3)班' }));
  await userEvent.click(within(dialog).getByRole('button', { name: '完成' }));
  await userEvent.click(within(dialog).getByRole('button', { name: '布置给 2 个班' }));

  expect(calls.find((call) => call.key === 'POST /api/teacher/assignments/p_2/assign')?.body)
    .toEqual({ class_ids: ['c_2', 'c_1'], delivery: 'paper' });
  expect(await screen.findByRole('status')).toHaveTextContent('已为 2 个班起草，点班级进入逐人审核');
  await waitFor(() => expect(within(screen.getByRole('listitem', { name: '第三周个性化作业' }))
    .getByRole('list', { name: '高一(5)班作业流程' })).toBeInTheDocument());
});

test('partly collected homework opens review while keeping collection available', async () => {
  window.history.pushState({}, '', '/papers');
  mockApi({
    'GET /api/teacher/assignments': () => ({ body: [{ ...TEST, classes: [given('a_partial', 'c_1', { collected: 1 })] }] }),
    'GET /api/teacher/classes': () => ({ body: CLASSES }),
  });
  render(<App />);
  const flow = await screen.findByRole('list', { name: '高一(3)班作业流程' });
  expect(within(flow).getByRole('link', { name: '预批与审核' })).toHaveAttribute('href', '/assignments/a_partial/review');
  expect(within(flow).getByRole('link', { name: '预批与审核' })).toHaveAttribute('aria-current', 'step');
  expect(within(flow).getByRole('link', { name: '继续收卷' })).toHaveAttribute('href', '/assignments/a_partial/collect');
  expect(within(flow).getByRole('button', { name: '学情报告' })).toBeDisabled();
});

test('copying a test opens the copy in the composer', async () => {
  window.history.pushState({}, '', '/papers');
  mockApi({
    'GET /api/teacher/assignments': () => ({ body: [TEST] }),
    'GET /api/teacher/classes': () => ({ body: CLASSES }),
    'POST /api/teacher/assignments/p_1/copy': () => ({ status: 201, body: { id: 'p_9' } }),
    'GET /api/teacher/assignments/p_9': () => ({ body: {
      ...TEST, id: 'p_9', status: 'draft', title: '运动学单元测验（副本）', class_name: null, items: [], assigned: [],
    } }),
    'GET /api/teacher/knowledge-points': () => ({ body: [] }),
    'GET /api/teacher/question-bank/outline': () => ({ body: { volumes: {}, chapters: {}, sections: {}, points: {} } }),
    'GET /api/teacher/questions': () => ({ body: { items: [], total: 0, page: 1, page_size: 10 } }),
  });
  render(<App />);

  const row = await screen.findByRole('listitem', { name: '运动学单元测验' });
  await userEvent.click(within(row).getByRole('button', { name: '复制' }));
  expect(await screen.findByLabelText('作业名称')).toHaveValue('运动学单元测验（副本）');
});

test('班级学情 keeps score history and links to the assignment workspace', async () => {
  window.history.pushState({}, '', '/classes/c_1?view=history');
  const data: ClassHomework = {
    assignments: [
      { id: 'a_3', class_id: 'c_1', title: '运动学单元测验', kind: 'test', status: 'published', question_count: 2,
        total_points: 20, created_at: null, published_at: '2026-10-22T08:00:00Z', results_released_at: '2026-10-23T00:00:00Z',
        collected: 2, member_count: 2, average: 15, rate: 0.75 },
      { id: 'a_7', class_id: 'c_1', title: '第三周个性化作业', kind: 'personalized', status: 'draft', question_count: 6,
        total_points: null, created_at: null, published_at: null, results_released_at: null,
        collected: 0, member_count: 2, average: null, rate: null },
    ],
    students: [
      { student_id: 's_1', display_name: 'Alice', student_number: '1', scores: { a_3: { score: 18, full: 20 } } },
      { student_id: 's_2', display_name: 'Bob', student_number: '2', scores: {} , missing: ['a_3'] },
    ],
  };
  mockApi({
    'GET /api/teacher/classes/c_1': () => ({ body: { ...CLASSES[0], members: [] } }),
    'GET /api/teacher/classes/c_1/homework': () => ({ body: data }),
    'GET /api/teacher/classes/c_1/dashboard': () => ({ body: { summary: { student_count: 0, active_student_count: 0, pending_mistake_count: 0, avg_mastery: 0 }, students: [], weak_points: [], hot_mistakes: [], statistics: { summary: { data_students: 1, practice_count: 0, released_assignments: 1 }, students: [], knowledge_points: [] } } }),
  });
  render(<App />);

  const scores = await screen.findByRole('table', { name: '成绩表' });
  expect(within(scores).getByText('18 / 20')).toBeInTheDocument();
  // Not handing in reads differently from not being in the class at the time.
  expect(within(scores).getByText('缺交')).toBeInTheDocument();
  expect(within(scores).queryByText('第三周个性化作业')).toBeNull();
  expect(screen.queryByRole('link', { name: '给本班布置作业' })).toBeNull();
  expect(screen.queryByRole('link', { name: '作业数据' })).toBeNull();
  expect(screen.getByRole('button', { name: '历次成绩' })).toHaveAttribute('aria-current', 'page');
  expect(within(scores).getByRole('link', { name: '运动学单元测验' })).toHaveAttribute('href', '/assignments/a_3?tab=students');
});

test('library entries offer deletion while drafts still require confirmation', async () => {
  window.history.pushState({}, '', '/papers');
  let library = [TEST, HOMEWORK, UNUSED];
  const calls = mockApi({
    'GET /api/teacher/assignments': () => ({ body: library }),
    'GET /api/teacher/classes': () => ({ body: CLASSES }),
    'DELETE /api/teacher/assignments/p_3': () => { library = library.filter((entry) => entry.id !== 'p_3'); return { status: 204, body: null }; },
  });
  render(<App />);
  const draft = await screen.findByRole('listitem', { name: '热学检测' });
  expect(within(screen.getByRole('listitem', { name: '运动学单元测验' })).getByRole('button', { name: '删除' })).toBeEnabled();
  expect(within(screen.getByRole('listitem', { name: '第三周个性化作业' })).getByRole('button', { name: '删除' })).toBeEnabled();
  await userEvent.click(within(draft).getByRole('button', { name: '删除' }));
  let dialog = screen.getByRole('dialog', { name: '删除作业' });
  expect(within(dialog).getByText(/热学检测/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus();
  await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false);
  expect(draft).toBeInTheDocument();
  await userEvent.click(within(draft).getByRole('button', { name: '删除' }));
  dialog = screen.getByRole('dialog', { name: '删除作业' });
  await userEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(screen.queryByRole('listitem', { name: '热学检测' })).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent('已删除“热学检测”');
  expect(calls.filter((call) => call.key.startsWith('DELETE'))).toEqual([{ key: 'DELETE /api/teacher/assignments/p_3', body: null }]);
  expect(screen.getByRole('listitem', { name: '运动学单元测验' })).toBeInTheDocument();
});

test('failed deletion keeps the draft and allows a retry', async () => {
  window.history.pushState({}, '', '/papers');
  let attempt = 0;
  let library = [UNUSED];
  mockApi({
    'GET /api/teacher/assignments': () => ({ body: library }),
    'GET /api/teacher/classes': () => ({ body: CLASSES }),
    'DELETE /api/teacher/assignments/p_3': () => {
      if (++attempt === 1) return { status: 503, body: { detail: '暂时无法删除，请重试' } };
      library = []; return { status: 204, body: null };
    },
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '删除', }));
  const dialog = screen.getByRole('dialog', { name: '删除作业' });
  await userEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('暂时无法删除');
  expect(screen.getByRole('listitem', { name: '热学检测' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: '确认删除' })).toBeEnabled();
  await userEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(screen.queryByRole('listitem', { name: '热学检测' })).toBeNull());
});

test.each([TEST, HOMEWORK])('deleting a $kind source removes its whole visible card', async (entry) => {
  window.history.pushState({}, '', '/papers');
  let library: LibraryEntry[] = [entry];
  const calls = mockApi({
    'GET /api/teacher/assignments': () => ({ body: library }),
    'GET /api/teacher/classes': () => ({ body: CLASSES }),
    [`DELETE /api/teacher/assignments/${entry.id}`]: () => {
      library = [];
      return { status: 204, body: null };
    },
  });
  render(<App />);
  const source = await screen.findByRole('listitem', { name: entry.title });
  await userEvent.click(within(source).getByRole('button', { name: '删除' }));
  const dialog = screen.getByRole('dialog', { name: '删除作业' });
  expect(within(dialog).getByText(/已有作答、成绩和学情数据会保留/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(screen.queryByRole('listitem', { name: entry.title })).toBeNull());
  await waitFor(() => expect(calls.filter((call) => call.key === 'GET /api/teacher/assignments')).toHaveLength(2));
  expect(calls.filter((call) => call.key.startsWith('DELETE'))).toEqual([{ key: `DELETE /api/teacher/assignments/${entry.id}`, body: null }]);
});

test('old class homework links redirect to filtered homework management', async () => {
  window.history.pushState({}, '', '/classes/c_1/assignments');
  mockApi({ 'GET /api/teacher/assignments': () => ({ body: [TEST] }), 'GET /api/teacher/classes': () => ({ body: CLASSES }) });
  render(<App />);
  expect(await screen.findByRole('heading', { name: '作业管理' })).toBeInTheDocument();
  expect(screen.getByLabelText('按班级查看')).toHaveValue('c_1');
  expect(window.location.pathname).toBe('/papers');
});

test('a class record whose original paper was removed still offers deletion', async () => {
  window.history.pushState({}, '', '/papers');
  const execution: LibraryEntry = { ...TEST, id: 'a_3', class_id: 'c_1', source_id: null,
    is_paper: false, status: 'published', classes: [TEST.classes[0]] };
  let library = [execution];
  const calls = mockApi({
    'GET /api/teacher/assignments': () => ({ body: library }),
    'GET /api/teacher/classes': () => ({ body: CLASSES }),
    'DELETE /api/teacher/assignments/a_3': () => { library = []; return { status: 204, body: null }; },
  });
  render(<App />);
  const card = await screen.findByRole('listitem', { name: execution.title });
  await userEvent.click(within(card).getByRole('button', { name: '删除' }));
  const dialog = screen.getByRole('dialog', { name: '删除作业' });
  expect(dialog).toHaveTextContent('移除 1 个班级');
  await userEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(screen.queryByRole('listitem', { name: execution.title })).toBeNull());
  expect(calls.filter((call) => call.key.startsWith('DELETE'))).toHaveLength(1);
});
