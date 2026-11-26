import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import AssignDialog from '../components/AssignDialog';
import type { AssignmentDetail, BankQuestion, PaperItem, StudentPaper, TeacherClassSummary } from '../types';

const AUTH = {
  access_token: 'ready-token',
  teacher: { id: 't_1', username: 'wang', display_name: '王老师', must_change_password: false },
};

function question(id: string, type = 'single_choice'): BankQuestion {
  return {
    id, question_type: type, difficulty_tier: 'medium', stem_text: `${id} 题干`,
    options: type === 'single_choice' ? [{ label: 'A', text: '1' }, { label: 'B', text: '2' }] : [],
    image_paths: [], answer: 'A', primary_kp: { id: 'kp_a', name: '匀变速直线运动', chapter: '匀变速直线运动' },
    default_points: 4, default_box: type === 'single_choice' ? null : 'large', class_attempted: 0, class_correct_rate: null,
  };
}

function item(number: number, id: string, rule: PaperItem['rule'], reason: string, type = 'single_choice'): PaperItem {
  return { number, question_id: id, points: type === 'single_choice' ? 4 : 12, box: type === 'single_choice' ? null : 'large',
    question: question(id, type), rule, reason };
}

const ALICE: StudentPaper = {
  student_id: 's_1', display_name: 'Alice', student_number: '3', delivery: 'app', total_points: 16,
  items: [item(1, 'q_v1', 'same_error', '《单元测验》第 3 题因“概念理解错误”做错，推同模型变式'),
    item(2, 'q_p1', 'weak_kp', '“自由落体”掌握度 25%（薄弱），补练较易题', 'problem_solving')],
};
const BOB: StudentPaper = {
  student_id: 's_2', display_name: 'Bob', student_number: '12', delivery: 'paper', total_points: 4,
  items: [item(1, 'q_c9', 'coverage', '暂无足够作答数据，按范围补练“匀变速直线运动”')],
};

function personalized(papers: StudentPaper[], status: 'draft' | 'published' = 'draft'): AssignmentDetail {
  return {
    id: 'a_9', class_id: 'c_1', class_name: '高一(3)班', title: '第三周个性化作业', kind: 'personalized', status,
    question_count: 2, total_points: null, created_at: null, published_at: null, items: [],
    settings: { scope: [{ volume: '必修 第一册', chapter: '匀变速直线运动' }], choice_count: 1, area_count: 1 },
    papers,
  };
}

function mockApi(handlers: Record<string, (init?: RequestInit) => { status?: number; body: unknown }>) {
  const calls: Array<{ key: string; body: unknown }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method || 'GET'} ${url.pathname}`;
    calls.push({ key: `${key}${url.search}`, body: init?.body ? JSON.parse(String(init.body)) : null });
    const handler = handlers[key];
    if (!handler) return new Response(JSON.stringify({ detail: `unexpected ${key}` }), { status: 500 });
    const result = handler(init);
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200 });
  });
  return calls;
}

beforeEach(() => {
  window.localStorage.setItem('openphysics:teacher:auth', JSON.stringify(AUTH));
});

const CLASS_LIST: TeacherClassSummary[] = [
  { id: 'c_1', name: '高一(3)班', grade: '高一', level: 'standard', archived: false, member_count: 2 },
  { id: 'c_2', name: '高一(5)班', grade: '高一', level: 'standard', archived: false, member_count: 1 },
  { id: 'c_3', name: '高一(9)班', grade: '高一', level: 'standard', archived: false, member_count: 0 },
];

const composeRoutes = {
  'GET /api/teacher/classes': () => ({ body: CLASS_LIST }),
  'GET /api/teacher/knowledge-points': () => ({ body: [
    { id: 'kp_a', name: '匀变速直线运动', volume: '必修 第一册', chapter: '第二章 匀变速直线运动的研究', section: null },
    { id: 'kp_b', name: '牛顿第二定律', volume: '必修 第一册', chapter: '第四章 运动和力的关系', section: null },
  ] }),
  'GET /api/teacher/question-bank/outline': () => ({ body: {
    volumes: { '必修 第一册': 9 }, chapters: { '必修 第一册||第二章 匀变速直线运动的研究': 5 }, sections: {}, points: {},
  } }),
  'GET /api/teacher/questions': () => ({ body: { items: [question('q_c9')], total: 1, page: 1, page_size: 10 } }),
};

const CLASS_DETAIL = {
  ...CLASS_LIST[0],
  members: [
    { id: 's_1', username: 'alice', display_name: 'Alice', status: 'active', student_number: '1', last_login_at: null },
    { id: 's_2', username: 'bob', display_name: 'Bob', status: 'active', student_number: '2', last_login_at: null },
  ],
};

test('personalized drafting can select one student and does not submit the rest of the class', async () => {
  window.history.pushState({}, '', '/?mode=personalized&for=c_1');
  const calls = mockApi({
    ...composeRoutes,
    'GET /api/teacher/classes/c_1': () => ({ body: CLASS_DETAIL }),
    'POST /api/teacher/personalized': () => ({ status: 201, body: {
      paper: { ...personalized([]), id: 'a_8', class_id: null }, assigned: [personalized([ALICE])],
    } }),
    'GET /api/teacher/assignments/a_9': () => ({ body: personalized([ALICE]) }),
  });
  render(<App />);
  const recipients = await screen.findByRole('region', { name: '布置对象' });
  await userEvent.click(await within(recipients).findByRole('button', { name: '选择班级和学生' }));
  await userEvent.click(screen.getByRole('button', { name: '展开高一(3)班学生' }));
  await userEvent.click(await screen.findByRole('checkbox', { name: '高一(3)班学生 Bob' }));
  expect(screen.getByRole('checkbox', { name: '高一(3)班学生 Bob' })).not.toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(within(recipients).getByRole('button', { name: '选择班级和学生' })).toHaveTextContent('已选 1 人');
  await userEvent.click(screen.getByRole('checkbox', { name: '必修 第一册' }));
  await userEvent.click(screen.getByRole('button', { name: '为 1 名学生起草' }));
  await screen.findByLabelText('Alice 的作业');
  const body = calls.find((call) => call.key === 'POST /api/teacher/personalized')?.body as Record<string, unknown>;
  expect(body.student_ids_by_class).toEqual({ c_1: ['s_1'] });
  expect(screen.queryByLabelText('Bob 的作业')).not.toBeInTheDocument();
});

test('reusing personalized settings also supports named students and refuses an empty selection', async () => {
  const calls = mockApi({
    'GET /api/teacher/classes/c_1': () => ({ body: CLASS_DETAIL }),
    'POST /api/teacher/assignments/a_8/assign': () => ({ body: { assigned: [personalized([BOB])] } }),
  });
  const done = vi.fn();
  render(<AssignDialog assignmentId="a_8" title="补练" kind="personalized" assigned={[]} classes={CLASS_LIST}
    preselected={['c_1']} onClose={vi.fn()} onDone={done} />);
  await userEvent.click(screen.getByRole('button', { name: '选择班级和学生' }));
  await userEvent.click(screen.getByRole('button', { name: '展开高一(3)班学生' }));
  await userEvent.click(await screen.findByRole('checkbox', { name: '高一(3)班学生 Alice' }));
  await userEvent.click(screen.getByRole('checkbox', { name: '高一(3)班学生 Bob' }));
  expect(screen.getByRole('button', { name: '请选择班级' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: '高一(3)班学生 Bob' }));
  await userEvent.click(screen.getByRole('button', { name: '完成' }));
  await userEvent.click(screen.getByRole('button', { name: '布置给 1 个班' }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(calls.find((call) => call.key.endsWith('/assign'))?.body).toEqual({
    class_ids: ['c_1'], student_ids_by_class: { c_1: ['s_2'] }, delivery: 'paper',
  });
});

test('at 组卷 a teacher switches to 个性化作业, picks the class, chapters and counts, and the class is drafted', async () => {
  window.history.pushState({}, '', '/?for=c_1');
  const calls = mockApi({
    ...composeRoutes,
    'POST /api/teacher/personalized': () => ({ status: 201, body: {
      paper: { ...personalized([]), id: 'a_8', class_id: null }, assigned: [personalized([ALICE, BOB])],
    } }),
    'GET /api/teacher/assignments/a_9': () => ({ body: personalized([ALICE, BOB]) }),
  });
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: '个性化作业' }));
  const form = await screen.findByRole('form', { name: '个性化作业设置' });
  await userEvent.type(screen.getByLabelText('作业名称'), '第三周个性化作业');
  // Opened from a class, that class is already chosen.
  expect(screen.getByRole('button', { name: '选择班级和学生' })).toHaveTextContent('高一(3)班 · 全班 2 人');
  // The bank is shown to look through, not to add from.
  const browser = await screen.findByRole('region', { name: '题库选题' });
  expect(within(browser).queryByRole('button', { name: /加入/ })).toBeNull();

  await userEvent.click(await screen.findByRole('button', { name: '展开必修 第一册' }));
  await userEvent.click(screen.getByLabelText('第二章 匀变速直线运动的研究'));
  expect(within(form).queryByRole('region', { name: '出题范围' })).not.toBeInTheDocument();
  expect(within(form).queryByRole('heading', { name: '怎么起草' })).not.toBeInTheDocument();
  await userEvent.clear(within(form).getByLabelText('选择题'));
  await userEvent.type(within(form).getByLabelText('选择题'), '3');
  await userEvent.clear(within(form).getByLabelText('实验题'));
  await userEvent.type(within(form).getByLabelText('实验题'), '2');
  await userEvent.clear(within(form).getByLabelText('计算题'));
  await userEvent.type(within(form).getByLabelText('计算题'), '3');
  await userEvent.click(within(form).getByRole('button', { name: '起草全班作业' }));

  expect(calls.find((call) => call.key.startsWith('POST'))?.body).toEqual({
    title: '第三周个性化作业', scope: [{ volume: '必修 第一册', chapter: '第二章 匀变速直线运动的研究' }],
    choice_count: 3, experiment_count: 2, calculation_count: 3, class_ids: ['c_1'], delivery: 'paper',
  });
  // One class: straight into its review.
  expect(await screen.findByText('Alice')).toBeInTheDocument();
});

test('drafting for several classes stays at 组卷 and links each class to review', async () => {
  window.history.pushState({}, '', '/personalized/new');
  mockApi({
    ...composeRoutes,
    'POST /api/teacher/personalized': () => ({ status: 201, body: {
      paper: { ...personalized([]), id: 'a_8', class_id: null },
      assigned: [personalized([ALICE]), { ...personalized([BOB]), id: 'a_10', class_id: 'c_2', class_name: '高一(5)班' }],
    } }),
  });
  render(<App />);

  // The old address opens 组卷 in personalized mode.
  expect(await screen.findByRole('button', { name: '个性化作业', pressed: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '起草全班作业' })).toBeDisabled();
  expect(screen.queryByText(/还需要：/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '选择班级和学生' }));
  expect(screen.getByRole('checkbox', { name: '高一(9)班' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: '高一(3)班' }));
  await userEvent.click(screen.getByRole('checkbox', { name: '高一(5)班' }));
  await userEvent.click(screen.getByRole('button', { name: '完成' }));
  await userEvent.click(await screen.findByLabelText('必修 第一册'));
  await userEvent.click(screen.getByRole('button', { name: '为 2 个班起草' }));

  const done = await screen.findByText(/已为 2 个班起草/);
  expect(within(done).getByRole('link', { name: '高一(5)班' })).toHaveAttribute('href', '/assignments/a_10');
  expect(window.location.pathname).toBe('/');
});

test('each student paper shows why every question was chosen, and can be changed', async () => {
  window.history.pushState({}, '', '/assignments/a_9');
  const calls = mockApi({
    'GET /api/teacher/assignments/a_9': () => ({ body: personalized([ALICE, BOB]) }),
    'GET /api/teacher/assignments/a_9/papers/s_1/alternatives': () => ({ body: [question('q_v2')] }),
    'PUT /api/teacher/assignments/a_9/papers/s_1': () => ({ body: personalized([ALICE, BOB]) }),
    'PUT /api/teacher/assignments/a_9/papers/delivery': () => ({ body: { ...personalized([{ ...ALICE, delivery: 'paper' }, BOB]), settings: { delivery: 'paper' } } }),
  });
  render(<App />);

  const panel = await screen.findByRole('generic', { name: 'Alice 的作业' });
  expect(within(panel).getByText('同错因变式')).toBeInTheDocument();
  expect(within(panel).getByText(/因“概念理解错误”做错，推同模型变式/)).toBeInTheDocument();
  expect(screen.getByText(/1 人在 App 作答、1 人打印/)).toBeInTheDocument();

  await userEvent.click(within(panel).getAllByRole('button', { name: '换题' })[0]);
  await userEvent.click(await within(panel).findByRole('button', { name: '换成这道' }));
  await waitFor(() => expect(calls.some((call) => call.key === 'PUT /api/teacher/assignments/a_9/papers/s_1')).toBe(true));
  expect(calls.find((call) => call.key.startsWith('PUT'))?.body).toEqual({
    items: [{ question_id: 'q_v2' }, { question_id: 'q_p1', points: 12, box: 'large', area_mm: null }],
  });

  expect(within(panel).queryByLabelText('Alice 的交付方式')).toBeNull();
  expect(screen.getByRole('button', { name: '发布作业' })).toBeDisabled();
  await userEvent.click(screen.getByRole('radio', { name: '打印' }));
  await waitFor(() => expect(calls.filter((call) => call.key.startsWith('PUT'))[1]?.body).toEqual({ delivery: 'paper' }));

  await userEvent.click(screen.getByRole('button', { name: /12 Bob/ }));
  expect(await screen.findByRole('generic', { name: 'Bob 的作业' })).toBeInTheDocument();
});

test('printing gives each paper student their own sheet with name and number printed in', async () => {
  window.history.pushState({}, '', '/assignments/a_9/print');
  mockApi({
    'GET /api/teacher/assignments/a_9': () => ({ body: personalized([ALICE, BOB, { ...BOB, student_id: 's_3',
      display_name: 'Carol', student_number: '7', delivery: 'paper' }], 'published') }),
    'GET /api/teacher/classes/c_1': () => ({ body: { id: 'c_1', name: '高一(3)班', grade: '高一', level: 'standard',
      archived: false, member_count: 3, members: [{ id: 's_2', username: 'b', display_name: 'Bob', status: 'active',
        last_login_at: null, student_number: '12' }] } }),
  });
  const { container } = render(<App />);

  // Alice answers in the app, so only Bob and Carol get a printed sheet.
  expect(await screen.findByRole('region', { name: 'Bob 的作业' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Carol 的作业' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Alice 的作业' })).toBeNull();
  const carol = screen.getByRole('region', { name: 'Carol 的作业' });
  expect(within(carol).getByText('Carol')).toHaveClass('printed-name');
  expect([...carol.querySelectorAll('.number-box')].map((box) => box.textContent)).toEqual(['', '7']);
  expect(container.querySelectorAll('.print-sheet')).toHaveLength(2);
});
