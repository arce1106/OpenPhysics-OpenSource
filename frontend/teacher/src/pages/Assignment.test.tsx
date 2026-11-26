import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import type { AssignmentDetail, BankQuestion, ItemInput, TeacherAuth } from '../types';

const READY: TeacherAuth = {
  access_token: 'ready-token',
  teacher: { id: 't_1', username: 'wang', display_name: '王老师', must_change_password: false },
};

function question(id: string, overrides: Partial<BankQuestion> = {}): BankQuestion {
  return {
    id,
    question_type: 'single_choice',
    difficulty_tier: 'medium',
    stem_text: `${id} 物体加速度 $a=\\frac{F}{m}$`,
    options: [{ label: 'A', text: '1 m/s²' }, { label: 'B', text: '2 m/s²' }],
    image_paths: [],
    answer: 'A',
    primary_kp: { id: 'kp_a', name: '牛顿第二定律', chapter: '运动和力的关系' },
    default_points: 4,
    default_box: null,
    class_attempted: 2,
    class_correct_rate: 0.5,
    ...overrides,
  };
}

const CLASS_3 = { id: 'c_1', name: '高一(3)班', grade: '高一', level: 'standard', archived: false, member_count: 2 };
const CLASS_5 = { id: 'c_2', name: '高一(5)班', grade: '高一', level: 'standard', archived: false, member_count: 1 };

const Q1 = question('q_1');
const Q2 = question('q_2', { question_type: 'problem_solving', default_points: 12, default_box: 'large', options: [] });

function draft(items: Array<{ q: BankQuestion; points: number; box: 'small' | 'medium' | 'large' | null }>): AssignmentDetail {
  return {
    id: 'a_1',
    class_id: 'c_1',
    class_name: '高一(3)班',
    title: '运动学单元测验',
    kind: 'test',
    status: 'draft',
    question_count: items.length,
    total_points: items.reduce((sum, item) => sum + item.points, 0),
    created_at: '2026-10-21T00:00:00Z',
    published_at: null,
    items: items.map((item, index) => ({
      number: index + 1, question_id: item.q.id, points: item.points, box: item.box, question: item.q,
    })),
  };
}

type Handler = (init?: RequestInit) => { status?: number; body: unknown; raw?: Blob };

function mockApi(routes: Record<string, Handler>) {
  const calls: Array<{ key: string; init?: RequestInit }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method || 'GET'} ${url.pathname}`;
    calls.push({ key: `${key}${url.search}`, init });
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ detail: `unexpected ${key}` }), { status: 500 });
    const result = handler(init);
    if (result.status === 204) return new Response(null, { status: 204 });
    if (result.raw) return new Response(result.raw, {
      status: result.status ?? 200, headers: { 'Content-Type': result.raw.type },
    });
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200 });
  });
  return calls;
}

beforeEach(() => {
  window.localStorage.setItem('openphysics:teacher:auth', JSON.stringify(READY));
});

const bankRoutes = {
  'GET /api/teacher/knowledge-points': () => ({
    body: [{ id: 'kp_a', name: '牛顿第二定律', volume: '必修一', chapter: '运动和力的关系', section: null }],
  }),
  'GET /api/teacher/questions': () => ({ body: { items: [Q1, Q2], total: 2, page: 1, page_size: 10 } }),
  'GET /api/teacher/classes': () => ({ body: [CLASS_3, CLASS_5] }),
  'GET /api/teacher/question-bank/outline': () => ({
    body: { volumes: { '必修一': 2 }, chapters: { '必修一||运动和力的关系': 2 }, sections: {}, points: { kp_a: 2 } },
  }),
};

function paper(items: Parameters<typeof draft>[0], assigned: AssignmentDetail['assigned'] = []): AssignmentDetail {
  return { ...draft(items), class_id: null, class_name: null, assigned };
}

test('saved paper keeps student and teacher editions in its toolbar without repeating question content', async () => {
  window.history.pushState({}, '', '/assignments/a_1');
  mockApi({ 'GET /api/teacher/assignments/a_1': () => ({ body: { ...paper([{ q: Q1, points: 4, box: null }]), status: 'saved' } }) });
  const { container } = render(<App />);
  expect(await screen.findByRole('link', { name: '教师版预览' })).toHaveAttribute('href', '/assignments/a_1/print?edition=teacher');
  expect(screen.getByRole('button', { name: '下载教师版' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '下载 PDF' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '预览' })).toHaveAttribute('href', '/assignments/a_1/print');
  expect(container.querySelector('.paper-items')).toBeNull();
});

test('a saved paper can be deleted from its own page and cancellation leaves it intact', async () => {
  window.history.pushState({}, '', '/assignments/a_1');
  const calls = mockApi({ ...bankRoutes,
    'GET /api/teacher/assignments/a_1': () => ({ body: { ...paper([{ q: Q1, points: 4, box: null }]), status: 'saved' } }),
    'DELETE /api/teacher/assignments/a_1': () => ({ status: 204, body: null }),
    'GET /api/teacher/assignments': () => ({ body: [] }),
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '删除试卷' }));
  await userEvent.click(within(screen.getByRole('dialog', { name: '删除作业' })).getByRole('button', { name: '取消' }));
  expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false);
  expect(window.location.pathname).toBe('/assignments/a_1');
  await userEvent.click(screen.getByRole('button', { name: '删除试卷' }));
  await userEvent.click(within(screen.getByRole('dialog', { name: '删除作业' })).getByRole('button', { name: '确认删除' }));
  expect(await screen.findByRole('heading', { name: '作业管理' })).toBeInTheDocument();
  expect(calls.filter((call) => call.key.startsWith('DELETE'))).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('已删除');
});

test.each(['student', 'teacher'] as const)('%s print edition shows solutions only in the teacher copy', async (edition) => {
  const calculation = { ...Q2, explanation: '用原始位移计算：$v=\\frac{x}{t}$。' };
  window.__OPENPHYSICS_PRINT__ = { edition, numberBoxes: 2,
    detail: { ...paper([{ q: Q1, points: 4, box: null }, { q: calculation, points: 12, box: 'large' }]), status: 'saved' } };
  try {
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.print-paper')).toHaveAttribute('data-pdf-ready', 'true'));
    if (edition === 'teacher') {
      expect(screen.getByRole('heading', { name: '运动学单元测验（教师版）' })).toBeInTheDocument();
      expect(screen.getByLabelText('第 1 题参考答案')).toHaveTextContent('A');
      expect(screen.getByLabelText('第 1 题解析')).toHaveTextContent('暂无解析');
      expect(screen.getByLabelText('第 2 题解析')).toHaveTextContent('用原始位移计算');
      expect(screen.getByLabelText('第 2 题解析').querySelector('.katex')).toBeInTheDocument();
      expect(container.querySelector('.answer-area')).toBeNull();
      expect(container.querySelector('.answer-table')).toBeNull();
      expect(container.querySelector('.number-boxes')).toBeNull();
    } else {
      expect(container.querySelector('.teacher-solution')).toBeNull();
      expect(container.querySelector('.answer-area')).toBeInTheDocument();
      expect(container.querySelector('.answer-table')).toBeInTheDocument();
      expect(screen.queryByText('参考答案')).toBeNull();
    }
  } finally { delete window.__OPENPHYSICS_PRINT__; }
});

test('teacher PDF downloads the teacher edition with a distinct file name', async () => {
  window.history.pushState({}, '', '/assignments/a_1');
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:teacher-pdf');
    static revokeObjectURL = vi.fn();
  });
  const calls = mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: { ...paper([{ q: Q1, points: 4, box: null }]), status: 'saved' } }),
    'GET /api/teacher/classes': () => ({ body: [] }),
    'GET /api/teacher/assignments/a_1/pdf': () => ({ body: null, raw: new Blob(['%PDF-1.7'], { type: 'application/pdf' }) }),
  });
  try {
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: '下载教师版' }));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(calls.some((call) => call.key.endsWith('/pdf?edition=teacher'))).toBe(true);
    expect(clicked[0].download).toBe('运动学单元测验（教师版）.pdf');
  } finally { vi.unstubAllGlobals(); }
});

test.each(['paper', 'app'] as const)('a composed test is assigned directly from its drawer using %s delivery', async (delivery) => {
  window.history.pushState({}, '', '/assignments/a_1');
  const execution = { ...draft([{ q: Q1, points: 4, box: null }]), id: 'a_direct', status: 'published',
    settings: { delivery }, collected: 0 };
  const calls = mockApi({
    ...bankRoutes,
    'GET /api/teacher/assignments/a_1': () => ({ body: paper([{ q: Q1, points: 4, box: null }]) }),
    'POST /api/teacher/assignments/a_1/assign': () => ({ body: { assigned: [execution] } }),
    'GET /api/teacher/assignments/a_direct': () => ({ body: execution }),
    'GET /api/teacher/assignments/a_direct/collection': () => ({ body: { assignment_id: 'a_direct', released: false,
      total: 2, collected: 0, students: [], batches: [], exceptions: [], ai_usage: {} } }),
    'GET /api/teacher/assignments/a_direct/review': () => ({ body: { released: false, questions: [], run: null, error_types: {} } }),
  });
  render(<App />);
  await screen.findByRole('region', { name: '试卷' });
  const drawer = within(screen.getByRole('region', { name: '试卷' }));
  expect(drawer.getByRole('button', { name: '完成布置' })).toBeDisabled();
  await userEvent.click(drawer.getByRole('button', { name: '选择班级' }));
  await userEvent.click(screen.getByRole('checkbox', { name: '高一(3)班' }));
  await userEvent.click(screen.getByRole('button', { name: '完成' }));
  await userEvent.click(drawer.getByRole('radio', { name: delivery === 'app' ? '推送 App' : '打印' }));
  await userEvent.click(drawer.getByRole('button', { name: '完成布置' }));
  await waitFor(() => expect(window.location.pathname).toBe('/assignments/a_direct'));
  expect(calls.filter((call) => call.key.endsWith('/assign'))).toHaveLength(1);
  expect(JSON.parse(String(calls.find((call) => call.key.endsWith('/assign'))?.init?.body))).toEqual({ class_ids: ['c_1'], delivery });
  expect(calls.some((call) => call.key.endsWith('/save'))).toBe(false);
  expect(screen.queryByRole('heading', { name: '2. 布置作业' })).toBeNull();
  expect(await screen.findByText('应交人数')).toBeInTheDocument();
  if (delivery === 'app') {
    expect(screen.queryByRole('link', { name: '打印预览' })).toBeNull();
    expect(screen.queryByRole('link', { name: '收卷' })).toBeNull();
  }
});

test('failed direct assignment keeps the questions, class and delivery ready for retry', async () => {
  window.history.pushState({}, '', '/assignments/a_1');
  mockApi({ ...bankRoutes,
    'GET /api/teacher/assignments/a_1': () => ({ body: paper([{ q: Q1, points: 4, box: null }]) }),
    'POST /api/teacher/assignments/a_1/assign': () => ({ status: 503, body: { detail: '布置暂时失败，请重试' } }),
  });
  render(<App />);
  await screen.findByRole('region', { name: '试卷' });
  await userEvent.click(screen.getByRole('button', { name: '选择班级' }));
  await userEvent.click(screen.getByRole('checkbox', { name: '高一(3)班' }));
  await userEvent.click(screen.getByRole('button', { name: '完成' }));
  await userEvent.click(screen.getByRole('radio', { name: '推送 App' }));
  await userEvent.click(screen.getByRole('button', { name: '完成布置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('布置暂时失败');
  expect(window.location.pathname).toBe('/assignments/a_1');
  expect(screen.getByRole('button', { name: '选择班级' })).toHaveTextContent('高一(3)班');
  expect(screen.getByRole('radio', { name: '推送 App' })).toBeChecked();
  expect(screen.getByLabelText('第 1 题分值')).toHaveValue(4);
  expect(screen.getByRole('button', { name: '完成布置' })).toBeEnabled();
});

test('组卷 starts a test with its first question; saving fixes it and opens it to download and publish', async () => {
  window.history.pushState({}, '', '/');
  let saved = false;
  const calls = mockApi({
    ...bankRoutes,
    'POST /api/teacher/assignments': () => ({ status: 201, body: paper([]) }),
    'PUT /api/teacher/assignments/a_1': () => ({ body: paper([{ q: Q1, points: 4, box: null }]) }),
    'POST /api/teacher/assignments/a_1/save': () => {
      saved = true;
      return { body: { ...paper([{ q: Q1, points: 4, box: null }]), status: 'saved', published_at: '2026-10-23T08:00:00Z' } };
    },
    'GET /api/teacher/assignments/a_1': () => ({
      body: { ...paper([{ q: Q1, points: 4, box: null }]), status: saved ? 'saved' : 'draft', published_at: '2026-10-23T08:00:00Z' },
    }),
  });
  render(<App />);

  expect(await screen.findByRole('button', { name: '测验', pressed: true })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '布置作业' })).toBeNull();
  expect(screen.getByRole('button', { name: '完成布置' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('作业名称'), '运动学单元测验');
  // Nothing is saved until the first question goes in.
  expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  const browser = await screen.findByRole('region', { name: '题库选题' });
  await userEvent.click(await within(browser).findByRole('button', { name: '加入 q_1' }));
  const created = calls.find((call) => call.key === 'POST /api/teacher/assignments');
  expect(JSON.parse(String(created?.init?.body))).toEqual({ title: '运动学单元测验' });
  // With no class picked the bank is searched without a class.
  expect(calls.some((call) => call.key.startsWith('GET /api/teacher/questions?') && !call.key.includes('class_id'))).toBe(true);

  expect(screen.queryByRole('button', { name: '选择班级和学生' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^试卷 \d/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '选择班级' }));
  await userEvent.click(screen.getByRole('checkbox', { name: '高一(5)班' }));
  await userEvent.click(screen.getByRole('button', { name: '完成' }));
  await userEvent.click(screen.getAllByRole('button', { name: '保存试卷' })[0]);
  expect(saved).toBe(true);
  expect(calls.filter((call) => call.key === 'POST /api/teacher/assignments/a_1/save')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '确认保存' })).toBeNull();

  // The saved paper: download, then publish to the class picked while composing.
  expect(await screen.findByText('已保存 · 不可修改')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('试卷已保存');
  expect(screen.getByRole('button', { name: '下载 PDF' })).toBeEnabled();
  expect(screen.queryByRole('heading', { name: '2. 布置作业' })).toBeNull();
  expect(screen.queryByRole('region', { name: '布置班级' })).toBeNull();
  expect(screen.getByRole('button', { name: '布置到班级' })).toBeEnabled();
  expect(screen.queryByLabelText('作业名称')).toBeNull();
});

test('publishing a saved paper sends it to the chosen classes and follows each one', async () => {
  window.history.pushState({}, '', '/assignments/a_1');
  const row = {
    id: 'a_3', class_id: 'c_1', class_name: '高一(3)班', archived: false, status: 'published' as const, created_at: null,
    published_at: '2026-10-23T09:00:00Z', results_released_at: null, collected: 0, member_count: 2,
  };
  let assigned: AssignmentDetail['assigned'] = [];
  const calls = mockApi({
    ...bankRoutes,
    'GET /api/teacher/assignments/a_1': () => ({ body: { ...paper([{ q: Q1, points: 4, box: null }], assigned), status: 'saved' } }),
    'POST /api/teacher/assignments/a_1/assign': () => {
      assigned = [row];
      return { body: { assigned: [{ ...draft([]), id: 'a_3', status: 'published' }] } };
    },
    'POST /api/teacher/assignments/a_1/copy': () => ({ status: 201, body: { ...paper([]), id: 'a_9' } }),
  });
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: '布置到班级' }));
  await userEvent.click(await screen.findByRole('button', { name: '选择班级' }));
  await userEvent.click(screen.getByRole('checkbox', { name: '高一(3)班' }));
  await userEvent.click(screen.getByRole('button', { name: '完成' }));
  await userEvent.click(screen.getByRole('button', { name: '发布给 1 个班' }));
  expect(screen.queryByRole('checkbox', { name: /学生 Alice/ })).toBeNull();
  expect(JSON.parse(String(calls.find((call) => call.key === 'POST /api/teacher/assignments/a_1/assign')?.init?.body)))
    .toEqual({ class_ids: ['c_1'], delivery: 'paper' });

  await waitFor(() => expect(window.location.pathname).toBe('/assignments/a_3'));

});

test('adding a bank question saves the paper and updates the blueprint', async () => {
  window.history.pushState({}, '', '/assignments/a_1');
  let saved: unknown = null;
  mockApi({
    ...bankRoutes,
    'GET /api/teacher/assignments/a_1': () => ({ body: draft([{ q: Q1, points: 4, box: null }]) }),
    'PUT /api/teacher/assignments/a_1': (init) => {
      saved = JSON.parse(String(init?.body));
      return { body: draft([{ q: Q1, points: 4, box: null }, { q: Q2, points: 12, box: 'large' }]) };
    },
  });
  render(<App />);

  const browser = await screen.findByRole('region', { name: '题库选题' });
  expect(await within(browser).findByRole('button', { name: '从试卷移出 q_1' })).toBeInTheDocument();
  expect(within(browser).getAllByText(/2 名学生做过，正确率 50%/)).toHaveLength(2);
  expect(browser.querySelector('.katex')).not.toBeNull();
  // The catalogue shows approved-question counts per level.
  const catalog = screen.getByRole('complementary', { name: '教材目录' });
  expect(within(catalog).getByRole('button', { name: /必修一\s*2/ })).toBeInTheDocument();

  await userEvent.click(within(browser).getByRole('button', { name: '加入 q_2' }));

  expect(saved).toEqual({
    items: [{ question_id: 'q_1', points: 4, box: null, area_mm: null }, { question_id: 'q_2' }],
  });
  expect(screen.queryByText(/已加入试卷/)).not.toBeInTheDocument();
  const blueprint = await screen.findByLabelText('试卷蓝图');
  await waitFor(() => expect(blueprint).toHaveTextContent('2 题16 分约 14 分钟'));
  expect(screen.getByLabelText('第 2 题作答框')).toHaveValue('large');
});

test('publishing asks for confirmation and then shows the print actions', async () => {
  window.history.pushState({}, '', '/assignments/a_1');
  const published = { ...draft([{ q: Q1, points: 4, box: null }]), status: 'published' as const,
    published_at: '2026-10-21T08:00:00Z' };
  const calls = mockApi({
    ...bankRoutes,
    'GET /api/teacher/assignments/a_1': () => ({ body: draft([{ q: Q1, points: 4, box: null }]) }),
    'POST /api/teacher/assignments/a_1/publish': () => ({ body: published }),
  });
  render(<App />);

  await screen.findByRole('region', { name: '试卷' });
  await userEvent.click(await screen.findByRole('button', { name: '发布测验' }));
  expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: '确认发布' }));

  expect(await screen.findByRole('navigation', { name: '作业管理与分析' })).toBeInTheDocument();
  expect(screen.getByText('待收卷')).toBeInTheDocument();
  const steps = screen.getByRole('list', { name: '作业进度' });
  expect(within(steps).getByRole('link', { name: '2收卷' }).closest('li')).toHaveClass('next');
  expect(within(steps).getByRole('link', { name: '2收卷' })).toHaveAttribute('href', '/assignments/a_1/collect');
  expect(screen.getByText('查看作业内容与交付')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '下载 PDF' })).toBeNull();
  expect(within(steps).getByRole('link', { name: '1打印作业' })).toHaveAttribute('href', '/assignments/a_1/print');
  expect(screen.queryByRole('button', { name: /答题卡/ })).toBeNull();
});

test('the homework doubles as the answer sheet', async () => {
  window.history.pushState({}, '', '/assignments/a_1/print');
  mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: draft([{ q: Q1, points: 4, box: null }, { q: Q2, points: 12, box: 'large' }]) }),
    'GET /api/teacher/classes/c_1': () => ({
      body: { id: 'c_1', name: '高一(3)班', grade: '高一', level: 'standard', archived: false, member_count: 1,
        members: [{ id: 's_1', username: 'alice_s', display_name: 'Alice', status: 'active', last_login_at: null, student_number: '105' }] },
    }),
  });
  const { container } = render(<App />);

  expect(await screen.findByRole('heading', { name: '运动学单元测验' })).toBeInTheDocument();
  expect(screen.getByText(/共 2 题 · 满分 16 分/)).toBeInTheDocument();
  expect(screen.getByText('作业编号 1')).toBeInTheDocument();
  await waitFor(() => expect(container.querySelectorAll('.number-box')).toHaveLength(3));

  const table = screen.getByRole('region', { name: '选择题答题表' });
  expect(within(table).getAllByRole('row')).toHaveLength(2);
  expect(within(table).getByText('1')).toBeInTheDocument();
  expect(within(table).queryByText('2')).toBeNull();

  // Workbook sections: points in the heading for choices, on the question for worked problems.
  expect(screen.getByRole('heading', { name: '一、选择题［第 1 题，4 分］' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '二、计算题［第 2 题，12 分］' })).toBeInTheDocument();
  expect(screen.getByText('1．')).toBeInTheDocument();
  expect(screen.getByText('[A]')).toBeInTheDocument();
  expect(container.querySelector('.print-options')).toHaveClass('four');
  expect(screen.getByText('2．（12分）')).toBeInTheDocument();
  expect(container.querySelector('.print-page-columns')).not.toBeNull();
  const area = screen.getByLabelText('第 2 题作答区');
  expect(area).toHaveClass('large');
  expect(screen.queryByLabelText('第 1 题作答区')).toBeNull();
  expect(container.querySelectorAll('.print-paper .katex').length).toBeGreaterThan(0);
});

test('a draft preview lets the teacher resize answer areas', async () => {
  window.history.pushState({}, '', '/assignments/a_1/print');
  let saved: { items: Array<Record<string, unknown>> } | null = null;
  const paper = draft([{ q: Q1, points: 4, box: null }, { q: Q2, points: 12, box: 'large' }]);
  mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: paper }),
    'GET /api/teacher/classes/c_1': () => ({
      body: { id: 'c_1', name: '高一(3)班', grade: '高一', level: 'standard', archived: false, member_count: 0, members: [] },
    }),
    'PUT /api/teacher/assignments/a_1': (init) => {
      saved = JSON.parse(String(init?.body));
      return { body: { ...paper, items: paper.items.map((item) => (item.number === 2 ? { ...item, area_mm: 120 } : item)) } };
    },
  });
  render(<App />);

  await waitFor(() => expect(document.querySelector('.print-paper')).toHaveAttribute('data-pdf-ready', 'true'));
  const area = await screen.findByLabelText('第 2 题作答区');
  expect(area).toHaveStyle({ height: '110mm' });
  await userEvent.click(screen.getByRole('button', { name: '第 2 题作答区增大' }));

  expect(await screen.findByText('作答区高度已保存')).toBeInTheDocument();
  expect(saved!.items).toEqual([
    { question_id: 'q_1', points: 4, box: null, area_mm: null },
    { question_id: 'q_2', points: 12, box: 'large', area_mm: 120 },
  ]);
  await waitFor(() => expect(document.querySelector('.print-paper')).toHaveAttribute('data-pdf-ready', 'true'));
  expect(screen.getByLabelText('第 2 题作答区')).toHaveStyle({ height: '120mm' });
  expect(screen.getByText('120 mm')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '恢复默认 110 mm' }));
  await waitFor(() => expect(saved!.items[1].area_mm).toBeNull());
});

test('draft print layout is saved with figure settings and column breaks while keeping answer areas', async () => {
  window.history.pushState({}, '', '/assignments/a_1/print');
  let paper = draft([{ q: { ...Q1, stem_text: '如图（　）{{IMG:0}}', image_paths: ['/static/questions/fixture.png'] }, points: 4, box: null },
    { q: Q2, points: 12, box: 'large' }]);
  paper.items[1].area_mm = 120;
  const writes: Array<{ items: Array<Record<string, unknown>> }> = [];
  mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: paper }),
    'GET /api/teacher/classes/c_1': () => ({ body: { id: 'c_1', members: [] } }),
    'PUT /api/teacher/assignments/a_1': (init) => {
      const body = JSON.parse(String(init?.body)); writes.push(body);
      paper = { ...paper, items: paper.items.map((item) => ({ ...item, ...body.items.find((next: ItemInput) => next.question_id === item.question_id) })) };
      return { body: paper };
    },
  });
  render(<App />);
  await screen.findByText('调整排版');
  await userEvent.click(screen.getByText('调整排版'));
  await userEvent.selectOptions(screen.getByLabelText('题图排布'), 'block');
  await waitFor(() => expect(screen.getByLabelText('题图排布')).toBeEnabled());
  await userEvent.selectOptions(screen.getByLabelText('题图宽度'), '55');
  await waitFor(() => expect(screen.getByLabelText('题图宽度')).toBeEnabled());
  await userEvent.click(screen.getByLabelText('另起一栏'));
  await waitFor(() => expect(writes[writes.length - 1]!.items[0].print_layout).toEqual({ figure: 'block', figure_width_mm: 55, break_before: 'column' }));
  expect(writes[writes.length - 1]!.items[1].area_mm).toBe(120);
  expect(screen.queryByText('答在答题表')).toBeNull();
  expect(document.querySelector('.choice-question')).toHaveAttribute('data-break-before', 'column');
  await waitFor(() => expect(screen.getByRole('button', { name: '恢复默认排版' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '恢复默认排版' }));
  await waitFor(() => expect(writes[writes.length - 1]!.items[0]).not.toHaveProperty('print_layout'));
});

test('the roster page assigns numbers students write on paper', async () => {
  window.history.pushState({}, '', '/classes/c_1/roster');
  const roster = (numbers: Array<string | null>) => ({
    id: 'c_1', name: '高一(3)班', grade: '高一', level: 'standard', archived: false, member_count: 2,
    members: [
      { id: 's_1', username: 'alice_s', display_name: 'Alice', status: 'active', last_login_at: null, student_number: numbers[0] },
      { id: 's_2', username: 'bob_s', display_name: 'Bob', status: 'active', last_login_at: null, student_number: numbers[1] },
    ],
  });
  let saved: unknown = null;
  mockApi({
    'GET /api/teacher/classes/c_1': () => ({ body: roster(['1', null]) }),
    'PUT /api/teacher/classes/c_1/members/s_1/number': (init) => {
      saved = JSON.parse(String(init?.body));
      return { body: roster(['7', null]) };
    },
    'POST /api/teacher/classes/c_1/members/auto-number': () => ({ body: roster(['7', '1']) }),
  });
  render(<App />);

  const alice = await screen.findByLabelText('Alice 的学号');
  expect(alice).toHaveValue('1');
  await userEvent.clear(alice);
  await userEvent.type(alice, '7');
  await userEvent.tab();
  expect(saved).toEqual({ student_number: '7' });

  await userEvent.click(await screen.findByRole('button', { name: '为 1 名未编号学生自动编号' }));
  expect(await screen.findByText('全部已编号')).toBeInTheDocument();
  expect(screen.getByLabelText('Bob 的学号')).toHaveValue('1');
});

test('picking a chapter in the catalogue scopes the question list', async () => {
  window.history.pushState({}, '', '/assignments/a_1');
  const calls = mockApi({
    ...bankRoutes,
    'GET /api/teacher/assignments/a_1': () => ({ body: draft([]) }),
  });
  render(<App />);

  const catalog = await screen.findByRole('complementary', { name: '教材目录' });
  await userEvent.click(await within(catalog).findByRole('button', { name: '展开必修一' }));
  await userEvent.click(within(catalog).getByRole('button', { name: /运动和力的关系\s*2/ }));

  await waitFor(() => expect(calls.some((call) => call.key.includes('/questions?')
    && call.key.includes(`chapter=${encodeURIComponent('运动和力的关系')}`)
    && call.key.includes(`volume=${encodeURIComponent('必修一')}`))).toBe(true));
  expect(screen.getByText(/运动和力的关系 · 共 2 道已审核题目/)).toBeInTheDocument();
});

test('turning a bank page scrolls the list back to the top', async () => {
  window.history.pushState({}, '', '/assignments/a_1');
  const calls = mockApi({
    ...bankRoutes,
    'GET /api/teacher/questions': () => ({ body: { items: [Q1, Q2], total: 30, page: 1, page_size: 10 } }),
    'GET /api/teacher/assignments/a_1': () => ({ body: draft([]) }),
  });
  render(<App />);

  const browser = await screen.findByRole('region', { name: '题库选题' });
  await within(browser).findByRole('button', { name: '加入 q_1' });
  browser.scrollTop = 800;
  await userEvent.click(within(browser).getByRole('button', { name: '下一页' }));

  expect(browser.scrollTop).toBe(0);
  await waitFor(() => expect(calls.some((call) => call.key.includes('/questions?') && call.key.includes('page=2'))).toBe(true));
});

test('下载 PDF saves a PDF file from paper management without opening print', async () => {
  window.history.pushState({}, '', '/assignments/a_1');
  const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
  const createUrl = vi.fn(() => 'blob:paper-pdf');
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createUrl;
    static revokeObjectURL = vi.fn();
  });
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
  const calls = mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: { ...paper([{ q: Q1, points: 4, box: null }]), status: 'saved' } }),
    'GET /api/teacher/assignments/a_1/pdf': () => ({ body: null, raw: new Blob(['%PDF-1.7'], { type: 'application/pdf' }) }),
    'GET /api/teacher/classes': () => ({ body: [] }),
  });
  render(<App />);

  expect(await screen.findByRole('heading', { name: '运动学单元测验' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '下载 PDF' }));
  await waitFor(() => expect(clicked).toHaveLength(1));
  expect(calls.filter((call) => call.key.endsWith('/pdf'))).toHaveLength(1);
  expect(clicked[0].download).toBe('运动学单元测验.pdf');
  expect(clicked[0].href).toBe('blob:paper-pdf');
  expect(print).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '下载 PDF' })).toBeInTheDocument();
  expect(screen.queryByText(/不计分/)).toBeNull();
  vi.unstubAllGlobals();
});

test('PDF failure is shown and can be retried without opening print', async () => {
  window.history.pushState({}, '', '/assignments/a_1');
  const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
  mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: { ...paper([{ q: Q1, points: 4, box: null }]), status: 'saved' } }),
    'GET /api/teacher/classes': () => ({ body: [] }),
    'GET /api/teacher/assignments/a_1/pdf': () => ({ status: 503, body: { detail: 'PDF 生成失败，请稍后重试' } }),
  });
  render(<App />);
  const download = await screen.findByRole('button', { name: '下载 PDF' });
  await userEvent.click(download);
  expect(await screen.findByRole('alert')).toHaveTextContent('PDF 生成失败');
  expect(download).toBeEnabled();
  expect(print).not.toHaveBeenCalled();
});

test('isolated PDF rendering uses the authorized snapshot without teacher login or API calls', async () => {
  window.localStorage.clear();
  window.__OPENPHYSICS_PRINT__ = {
    detail: { ...paper([{ q: Q1, points: 4, box: null }, { q: Q2, points: 12, box: 'large' }]), status: 'saved' },
    numberBoxes: 4,
  };
  const fetch = vi.spyOn(globalThis, 'fetch');
  try {
    render(<App />);
    expect(await screen.findByRole('heading', { name: '运动学单元测验' })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.print-paper')).toHaveAttribute('data-pdf-ready', 'true'));
    expect(document.querySelectorAll('.number-box')).toHaveLength(4);
    expect(screen.getByLabelText('第 2 题作答区')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载 PDF' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    delete window.__OPENPHYSICS_PRINT__;
  }
});

test('analysis handoff preselects named students and exact knowledge points without starting a draft', async () => {
  window.history.pushState({}, '', '/?mode=personalized&for=c_1&student=s_alice&kp=kp_a');
  const calls = mockApi({
    ...bankRoutes,
    'GET /api/teacher/classes/c_1': () => ({ body: { ...CLASS_3, members: [
      { id: 's_alice', username: 'alice', display_name: 'Alice', student_number: '1', status: 'active', last_login_at: null },
      { id: 's_bob', username: 'bob', display_name: 'Bob', student_number: '2', status: 'active', last_login_at: null },
    ] } }),
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '选择班级和学生' }));
  await userEvent.click(screen.getByRole('button', { name: '展开高一(3)班学生' }));
  expect(await screen.findByRole('checkbox', { name: '高一(3)班学生 Alice' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '高一(3)班学生 Bob' })).not.toBeChecked();
  expect(screen.queryByRole('region', { name: '出题范围' })).not.toBeInTheDocument();
  expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: '完成' }));
  const draftButton = screen.getByRole('button', { name: /起草/ });
  expect(draftButton).toBeEnabled();
  await userEvent.click(draftButton);
  const create = calls.find((c) => c.key === 'POST /api/teacher/personalized');
  expect(JSON.parse(String(create?.init?.body))).toMatchObject({ class_ids: ['c_1'], student_ids_by_class: { c_1: ['s_alice'] }, scope: [{ kp_id: 'kp_a' }] });
});
