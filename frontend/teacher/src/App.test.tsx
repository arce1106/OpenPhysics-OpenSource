import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { ClassDashboard, TeacherAuth, TeacherClassDetail } from './types';

const READY: TeacherAuth = {
  access_token: 'ready-token',
  teacher: { id: 't_1', username: 'wang', display_name: '王老师', must_change_password: false },
};

const CLASS_DETAIL: TeacherClassDetail = {
  id: 'c_1',
  name: '高一(3)班',
  grade: '高一',
  level: 'advanced',
  archived: false,
  member_count: 1,
  members: [{ id: 's_1', username: 'alice_s', display_name: 'Alice', status: 'active', last_login_at: null, student_number: null }],
};

const DASHBOARD: ClassDashboard = {
  statistics: {
    summary: { data_students: 1, practice_count: 5, released_assignments: 0 },
    students: [{ student_id: 's_1', display_name: 'Alice', student_number: null, practice_count: 5, practice_graded: 5, practice_correct_rate: 0.6, homework_expected: 0, homework_submitted: 0, homework_scored: 0, homework_rate: null, latest_activity_at: null, mastery: 0.42, knowledge_count: 1, evidence: 5, score: 0.6, level: 'developing', attention: [] }],
    knowledge_points: [{ kp_id: 'kp_force', kp_name: '受力分析', chapter: '相互作用', section: null, student_count: 1, practice_count: 5, practice_correct_rate: 0.6, homework_rate: null, students: [{student_id: 's_1', practice_count: 5, practice_graded: 5, practice_correct: 3, homework_earned: 0, homework_full: 0, mastery: 0.42 }] }],
  },
  summary: { student_count: 1, active_student_count: 1, pending_mistake_count: 2, avg_mastery: 0.42 },
  students: [{
    id: 's_1',
    username: 'alice_s',
    display_name: 'Alice',
    avg_mastery: 0.42,
    pending_mistake_count: 2,
    weak_chapters: [{ volume: '必修一', chapter: '相互作用', avg_mastery: 0.3, weak_kp_count: 1 }],
  }],
  weak_points: [{
    kp_id: 'kp_force',
    kp_name: '受力分析',
    chapter: '相互作用',
    section: null,
    weak_student_count: 1,
    avg_mastery: 0.3,
    pending_mistake_count: 1,
  }],
  hot_mistakes: [{
    question_id: 'q_1',
    stem_preview: '斜面上的物块受几个力',
    wrong_count: 2,
    affected_student_count: 1,
    kp_name: '受力分析',
    error_type_name: '漏力',
  }],
};

type Route = { status?: number; body: unknown };

function mockApi(routes: Record<string, Route | (() => Route)>) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input);
    calls.push({ path, init });
    const entry = routes[`${init?.method || 'GET'} ${path}`];
    const route = typeof entry === 'function' ? entry() : entry;
    if (!route) return new Response(JSON.stringify({ detail: `unexpected ${path}` }), { status: 500 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  });
  return calls;
}

function signedIn(auth: TeacherAuth) {
  window.localStorage.setItem('openphysics:teacher:auth', JSON.stringify(auth));
}

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

const COMPOSE_ROUTES: Record<string, Route> = {
  'GET /api/teacher/classes': { body: [CLASS_DETAIL] },
  'GET /api/teacher/assignments': { body: [] },
  'GET /api/teacher/knowledge-points': { body: [] },
  'GET /api/teacher/question-bank/outline': { body: { volumes: {}, chapters: {}, sections: {}, points: {} } },
  'GET /api/teacher/questions?page_size=10': { body: { items: [], total: 0, page: 1, page_size: 10 } },
};

test('signs in to 组卷 and uses the left navigation for homework management and classes', async () => {
  const calls = mockApi({
    'POST /api/teacher/auth/login': { body: READY },
    ...COMPOSE_ROUTES,
  });
  render(<App />);

  await userEvent.type(screen.getByLabelText('用户名'), ' wang ');
  await userEvent.type(screen.getByLabelText('密码'), 'teach2026new');
  await userEvent.click(screen.getByRole('button', { name: '登录' }));

  // The existing workspaces are directly accessible from the left navigation.
  const nav = await screen.findByRole('navigation');
  expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['作业管理', '组卷', '我的班级']);
  expect(within(nav).getByRole('link', { name: '组卷' })).toHaveClass('active');
  expect(await screen.findByRole('button', { name: '测验', pressed: true })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '试卷 0 题 · 0 分' })).toBeNull();
  expect(screen.getByLabelText('试卷蓝图')).toHaveTextContent('0 题0 分');

  await userEvent.click(screen.getByRole('button', { name: '王老师 ▾' }));
  const menu = screen.getByRole('menu', { name: '账户' });
  expect(within(menu).getByRole('menuitem', { name: '修改密码' })).toBeInTheDocument();
  await userEvent.click(within(nav).getByRole('link', { name: '作业管理' }));
  expect(await screen.findByRole('heading', { name: '作业管理' })).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: '作业管理' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('还没有组过卷。')).toBeInTheDocument();
  expect(screen.queryByRole('menu')).toBeNull();

  await userEvent.click(screen.getByRole('link', { name: '我的班级' }));
  expect(await within(screen.getByRole('main')).findByText('高一(3)班')).toBeInTheDocument();
  expect(screen.getByText('最近作业：还没有')).toBeInTheDocument();
  expect(screen.getByText('高一 · 实验班')).toBeInTheDocument();
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ username: 'wang', password: 'teach2026new' });
  const classesCall = calls.find((call) => call.path === '/api/teacher/classes');
  expect(new Headers(classesCall?.init?.headers).get('Authorization')).toBe('Bearer ready-token');
});

test('shows the login error from the server', async () => {
  mockApi({ 'POST /api/teacher/auth/login': { status: 401, body: { detail: '用户名或密码错误' } } });
  render(<App />);

  await userEvent.type(screen.getByLabelText('用户名'), 'wang');
  await userEvent.type(screen.getByLabelText('密码'), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: '登录' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码错误');
});

test('forces the initial password change before showing classes', async () => {
  signedIn({ ...READY, teacher: { ...READY.teacher, must_change_password: true } });
  const calls = mockApi({
    'POST /api/teacher/me/password': { body: { ...READY, access_token: 'fresh-token' } },
    ...COMPOSE_ROUTES,
  });
  render(<App />);

  expect(screen.getByRole('heading', { name: '请先修改初始密码' })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('当前密码'), 'init2026pass');
  await userEvent.type(screen.getByLabelText('新密码'), 'teach2026new');
  await userEvent.type(screen.getByLabelText('再次输入新密码'), 'teach2026nex');
  await userEvent.click(screen.getByRole('button', { name: '保存新密码' }));
  expect(screen.getByRole('alert')).toHaveTextContent('两次输入的新密码不一致');
  expect(calls).toHaveLength(0);

  await userEvent.clear(screen.getByLabelText('再次输入新密码'));
  await userEvent.type(screen.getByLabelText('再次输入新密码'), 'teach2026new');
  await userEvent.click(screen.getByRole('button', { name: '保存新密码' }));

  expect(await screen.findByRole('button', { name: '测验', pressed: true })).toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem('openphysics:teacher:auth') || '{}').access_token).toBe('fresh-token');
});

test('shows class learning signals', async () => {
  signedIn(READY);
  window.history.pushState({}, '', '/classes/c_1?view=students');
  mockApi({
    'GET /api/teacher/classes/c_1': { body: CLASS_DETAIL },
    'GET /api/teacher/classes/c_1/dashboard': { body: DASHBOARD },
    'GET /api/teacher/classes/c_1/students/s_1/statistics': { body: DASHBOARD.statistics },
    'GET /api/teacher/classes/c_1/records?student_id=s_1&wrong_only=false': { body: { items: [], has_more: false } },
  });
  render(<App />);

  expect(await screen.findByRole('heading', { name: '高一(3)班' })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: '班级学生统计' })).toBeInTheDocument();
  expect(screen.getByText('60%')).toBeInTheDocument();
  expect(screen.queryByText('42%')).toBeNull();
  expect(screen.queryByText('斜面上的物块受几个力')).toBeNull();
  await userEvent.click(screen.getByRole('link', { name: '查看 Alice 的学情' }));
  expect(await screen.findByRole('heading', { name: 'Alice 的学情', level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getAllByText(/42%/).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '受力分析' })).toBeInTheDocument();

});

test('a missing class shows an error with a way back', async () => {
  signedIn(READY);
  window.history.pushState({}, '', '/classes/c_other');
  mockApi({
    'GET /api/teacher/classes/c_other': { status: 404, body: { detail: '班级不存在' } },
    'GET /api/teacher/classes/c_other/dashboard': { status: 404, body: { detail: '班级不存在' } },
  });
  render(<App />);

  expect(await screen.findByRole('alert')).toHaveTextContent('班级不存在');
  expect(screen.getByRole('link', { name: '返回我的班级' })).toBeInTheDocument();
});

test('an expired token returns to the login page', async () => {
  signedIn(READY);
  mockApi({ 'GET /api/teacher/classes': { status: 401, body: { detail: 'Invalid or expired teacher token' } } });
  render(<App />);

  await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument());
  expect(window.localStorage.getItem('openphysics:teacher:auth')).toBeNull();
});

test('collapsing navigation preserves the composer input and is remembered after reopening', async () => {
  signedIn(READY);
  const calls = mockApi(COMPOSE_ROUTES);
  const view = render(<App />);
  const title = await screen.findByLabelText('作业名称');
  await userEvent.type(title, '导航收起测试');
  await userEvent.click(screen.getByRole('button', { name: '收起导航' }));
  expect(screen.getByRole('button', { name: '展开导航' })).toHaveAttribute('aria-expanded', 'false');
  expect(title).toHaveValue('导航收起测试');
  view.unmount();
  render(<App />);
  expect(screen.getByRole('button', { name: '展开导航' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '展开导航' }));
  expect(screen.getByRole('button', { name: '收起导航' })).toHaveAttribute('aria-expanded', 'true');
  expect(calls.some((call) => call.init?.method === 'POST')).toBe(false);
});

test('我的班级 opens the teacher class directory and its links open the selected class', async () => {
  signedIn(READY);
  window.history.pushState({}, '', '/papers');
  const second = { ...CLASS_DETAIL, id: 'c_2', name: '高一(5)班' };
  mockApi({
    'GET /api/teacher/assignments': { body: [] },
    'GET /api/teacher/classes': { body: [CLASS_DETAIL, second] },
    'GET /api/teacher/classes/c_2': { body: second },
    'GET /api/teacher/classes/c_2/dashboard': { body: DASHBOARD },
  });
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: '展开我的班级' }));
  const directory = await screen.findByRole('list', { name: '我的班级目录' });
  const secondLink = await within(directory).findByRole('link', { name: '高一(5)班' });
  expect(within(directory).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/classes/c_1', '/classes/c_2']);
  await userEvent.click(secondLink);
  expect(await within(screen.getByRole('main')).findByRole('heading', { name: '高一(5)班' })).toBeInTheDocument();
  expect(secondLink).toHaveClass('active');
});

test('我的班级 can be closed by clicking the same navigation entry again', async () => {
  signedIn(READY);
  window.history.pushState({}, '', '/classes');
  mockApi(COMPOSE_ROUTES);
  render(<App />);
  const entry = screen.getByRole('link', { name: '我的班级' });
  await userEvent.click(entry);
  expect(await screen.findByRole('list', { name: '我的班级目录' })).toBeInTheDocument();
  await userEvent.click(entry);
  expect(screen.queryByRole('list', { name: '我的班级目录' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '展开我的班级' })).toHaveAttribute('aria-expanded', 'false');
});

test('the collapsed class flyout closes on outside click, Escape and keyboard departure', async () => {
  signedIn(READY);
  window.localStorage.setItem('openphysics:teacher:sidebar-collapsed', 'true');
  window.history.pushState({}, '', '/classes');
  mockApi(COMPOSE_ROUTES);
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: '展开我的班级' }));
  expect(await screen.findByRole('list', { name: '我的班级目录' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('heading', { name: '我的班级' }));
  expect(screen.queryByRole('list', { name: '我的班级目录' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '展开我的班级' }));
  const directory = screen.getByRole('list', { name: '我的班级目录' });
  within(directory).getByRole('link', { name: CLASS_DETAIL.name }).focus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('list', { name: '我的班级目录' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '展开我的班级' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: '展开我的班级' }));
  within(screen.getByRole('list', { name: '我的班级目录' })).getByRole('link', { name: CLASS_DETAIL.name }).focus();
  await userEvent.tab();
  expect(screen.queryByRole('list', { name: '我的班级目录' })).not.toBeInTheDocument();
});

test('each class card invites its own students without opening the class page', async () => {
  signedIn(READY);
  window.history.pushState({}, '', '/classes');
  const second = { ...CLASS_DETAIL, id: 'c_2', name: '高三(7)班' };
  const calls = mockApi({
    ...COMPOSE_ROUTES,
    'GET /api/teacher/classes': { body: [CLASS_DETAIL, second] },
    'GET /api/teacher/classes/c_2/invitation': { body: { code: 'TEST2345', enabled: true, expires_at: '2026-11-02T12:00:00Z' } },
  });
  render(<App />);
  const card = await screen.findByRole('article', { name: second.name });
  const invite = within(card).getByRole('button', { name: '邀请学生' });
  expect(invite.closest('a')).toBeNull();
  await userEvent.click(invite);
  expect(await screen.findByLabelText('班级邀请码')).toHaveTextContent('TEST2345');
  expect(screen.getByRole('heading', { name: `邀请学生加入 ${second.name}` })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/classes');
  expect(calls.some(call => call.path === '/api/teacher/classes/c_2/invitation')).toBe(true);
  expect(calls.some(call => call.path === '/api/teacher/classes/c_1/invitation')).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(invite).toHaveFocus();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});


test('uses the shared brand icon without the teacher subtitle', async () => {
  signedIn(READY);
  mockApi(COMPOSE_ROUTES);
  render(<App />);
  const brand = await screen.findByRole('link', { name: 'OpenPhysics · 教师端' });
  expect(brand.querySelector('img')).toHaveAttribute('src', '/brand-icon.png');
  expect(brand).toHaveTextContent('OpenPhysics');
  expect(within(brand).queryByText('教师端')).not.toBeInTheDocument();
});
