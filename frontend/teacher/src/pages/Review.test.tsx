import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import type { Report, ReviewEntry, ReviewOverview } from '../types';

const AUTH = {
  access_token: 'ready-token',
  teacher: { id: 't_1', username: 'wang', display_name: '王老师', must_change_password: false },
};

const DETAIL = {
  id: 'a_1', class_id: 'c_1', class_name: '高一(3)班', title: '运动学作业', kind: 'test', status: 'published',
  question_count: 2, total_points: 16, created_at: null, published_at: null,
  results_released_at: null, collected: 2, items: [],
};

const ERROR_TYPES = { unit_direction: '单位或方向错误', calculation: '数学处理错误' };

function overview(pendingArea: number, released = false): ReviewOverview {
  return {
    assignment_id: 'a_1',
    released,
    run: { id: 'g_1', status: 'done', total: 1, done: 1, error: null },
    error_types: ERROR_TYPES,
    questions: [
      { number: 1, question_id: 'q_c', question_type: 'single_choice', points: 4, stem_text: '选择题', answer: 'A',
        image_paths: [], collected: 2, kind: 'choice', pending: 0, distribution: { A: 1, B: 1 }, correct_rate: 0.5 },
      { number: 2, question_id: 'q_p', question_type: 'problem_solving', points: 12, stem_text: '计算题 $v=at$',
        answer: '(1) 25 m/s', image_paths: [], collected: 2, kind: 'area', pending: pendingArea,
        rubric_status: 'approved', auto_passed: 1, confirmed: 0,
        rubric_parts: [{ label: '(1)', points: 5, criteria: ['写出公式得 2 分'] }, { label: '(2)', points: 7, criteria: ['方向正确'] }] },
    ],
  };
}

const ENTRIES: ReviewEntry[] = [
  { item_id: 11, student_id: 's_1', display_name: 'Alice', student_number: '1', ai_authorized: true, image_url: '/img/a',
    answer: null, grade_status: 'needs_review', score: 8, max_score: 12,
    part_scores: [{ label: '(1)', points: 5, score: 5, reason: '正确' }, { label: '(2)', points: 7, score: 3, reason: '漏了方向' }],
    error_type: 'unit_direction', error_type_name: '单位或方向错误', first_error: '没有说明方向', feedback: '注意方向',
    teacher_comment: null, confidence: 0.9, ai_error: null },
  { item_id: 12, student_id: 's_2', display_name: 'Bob', student_number: '2', ai_authorized: true, image_url: '/img/b',
    answer: null, grade_status: 'auto_passed', score: 12, max_score: 12,
    part_scores: [{ label: '(1)', points: 5, score: 5, reason: '' }, { label: '(2)', points: 7, score: 7, reason: '' }],
    error_type: 'none', error_type_name: null, first_error: null, feedback: null, teacher_comment: null, confidence: 0.95, ai_error: null },
];

type Handler = (init?: RequestInit) => { status?: number; body: unknown };

function mockApi(handlers: Record<string, Handler>) {
  const calls: Array<{ key: string; init?: RequestInit }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const key = `${init?.method || 'GET'} ${new URL(String(input), 'http://localhost').pathname}`;
    calls.push({ key, init });
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

test('reviews by question and saves part scores', async () => {
  window.history.pushState({}, '', '/assignments/a_1/review');
  let pending = 1;
  const calls = mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/review': () => ({ body: overview(pending) }),
    'GET /api/teacher/assignments/a_1/review/2': () => ({ body: ENTRIES }),
    'PUT /api/teacher/submission-items/11/grade': () => { pending = 0; return { status: 204, body: null }; },
    'POST /api/teacher/assignments/a_1/review/2/confirm-auto': () => ({ body: { confirmed: 1 } }),
  });
  render(<App />);

  expect(await screen.findByText('第 2 题（12 分）· 已收 2 份')).toBeInTheDocument();
  expect(screen.getByText('写出公式得 2 分')).toBeInTheDocument();
  expect(screen.getByText('1 待处理')).toBeInTheDocument();
  // The default filter shows only what still needs the teacher.
  expect(await screen.findByText('1 · Alice')).toBeInTheDocument();
  expect(screen.queryByText('2 · Bob')).toBeNull();
  expect(screen.getByText('漏了方向')).toBeInTheDocument();
  expect(screen.getByText('还有 1 份作答待处理，全部处理后才能发布结果。')).toBeInTheDocument();

  const second = screen.getByLabelText('Alice (2) 得分');
  await userEvent.clear(second);
  await userEvent.type(second, '4.5');
  await userEvent.type(screen.getByLabelText('Alice 评语'), '写清方向');
  await userEvent.click(screen.getByRole('button', { name: '确认' }));
  const saved = calls.find((call) => call.key === 'PUT /api/teacher/submission-items/11/grade');
  expect(JSON.parse(String(saved?.init?.body))).toEqual({
    comment: '写清方向', error_type: 'unit_direction',
    part_scores: [{ label: '(1)', score: 5 }, { label: '(2)', score: 4.5 }],
  });

  await userEvent.click(screen.getByRole('button', { name: '确认本题全部自动通过（1）' }));
  expect(calls.some((call) => call.key === 'POST /api/teacher/assignments/a_1/review/2/confirm-auto')).toBe(true);
  expect(await screen.findByRole('button', { name: '发布结果' })).toBeInTheDocument();
});

test('releasing results asks first and opens the report', async () => {
  window.history.pushState({}, '', '/assignments/a_1/review');
  const report: Report = {
    assignment_id: 'a_1', title: '运动学作业', released_at: '2026-10-22T08:00:00Z', total_points: 16,
    collected: 2, class_size: 3, average: 11, highest: 16, lowest: 6,
    bands: [{ label: '90–100%', count: 1 }, { label: '60% 以下', count: 1 }],
    questions: [{ number: 2, question_type: 'problem_solving', points: 12, average: 9, rate: 0.75,
      parts: [{ label: '(1)', points: 5, rate: 1 }, { label: '(2)', points: 7, rate: 0.5 }],
      errors: [{ error_type: 'unit_direction', name: '单位或方向错误', count: 1 }] }],
    errors: [{ error_type: 'unit_direction', name: '单位或方向错误', count: 1 }],
    students: [
      { student_id: 's_1', display_name: 'Alice', student_number: '1', submitted: true, total: 6, deviation: -5,
        scores: { 2: 6 }, repeated_errors: [] },
      { student_id: 's_3', display_name: 'Carol', student_number: '3', submitted: false },
    ],
    attention: [{ display_name: 'Alice', student_number: '1', total: 6, deviation: -5, repeated_errors: [] }],
  };
  let released = false;
  const calls = mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: { ...DETAIL, results_released_at: released ? report.released_at : null } }),
    'GET /api/teacher/assignments/a_1/collection': () => ({ body: { assignment_id: 'a_1', collected: 2, total: 3, students: [], batches: [], exceptions: [], ai_usage: {} } }),
    'GET /api/teacher/assignments/a_1/review': () => ({ body: { ...overview(0), turn_in: { expected: 3, collected: 2, missing: 1, app_working: 1, app_grading: 0 } } }),
    'GET /api/teacher/assignments/a_1/review/2': () => ({ body: [] }),
    'POST /api/teacher/assignments/a_1/release': () => { released = true; return { status: 204, body: null }; },
    'GET /api/teacher/assignments/a_1/report': () => ({ body: report }),
  });
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: '发布结果' }));
  expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  // Releasing closes unfinished App work: the teacher is told who that leaves out before confirming.
  expect(screen.getByText(/还有 1 名学生未交（其中 1 人正在 App 作答）/)).toHaveTextContent('发布后他们不能再提交');
  await userEvent.click(screen.getByRole('button', { name: '确认发布' }));

  expect(await screen.findByRole('heading', { name: '教学关注' })).toBeInTheDocument();
  expect(screen.getByText('2 / 3')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: '逐题分析' }));
  expect(await screen.findByText('(1) 100%；(2) 50%')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: '学生与成绩' }));
  expect(await screen.findByText('缺交')).toBeInTheDocument();
  await waitFor(() => expect(window.location.pathname).toBe('/assignments/a_1'));
});

test('an empty score box is not taken as zero', async () => {
  window.history.pushState({}, '', '/assignments/a_1/review');
  const blank = { ...ENTRIES[0], grade_status: 'manual' as const, ai_authorized: false, score: null, part_scores: null };
  const calls = mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/review': () => ({ body: overview(1) }),
    'GET /api/teacher/assignments/a_1/review/2': () => ({ body: [blank] }),
  });
  render(<App />);

  await userEvent.type(await screen.findByLabelText('Alice (1) 得分'), '5');
  await userEvent.click(screen.getByRole('button', { name: '确认' }));
  expect(screen.getByRole('alert')).toHaveTextContent('请先填写(2)的得分（没有得分请填 0）');
  expect(calls.some((call) => call.key.startsWith('PUT'))).toBe(false);
});

test('AI full-mark results are confirmed by the teacher as part of releasing', async () => {
  window.history.pushState({}, '', '/assignments/a_1/review');
  const calls = mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/review': () => ({ body: { ...overview(0), auto_passed: 2 } }),
    'GET /api/teacher/assignments/a_1/review/2': () => ({ body: [] }),
    'POST /api/teacher/assignments/a_1/review/confirm-auto': () => ({ body: { confirmed: 2 } }),
    'POST /api/teacher/assignments/a_1/release': () => ({ status: 204, body: null }),
    'GET /api/teacher/assignments/a_1/report': () => ({ status: 409, body: { detail: '…' } }),
  });
  render(<App />);

  await userEvent.click(await screen.findByRole('button', { name: '确认 2 份自动通过并发布结果' }));
  expect(screen.getByText(/其中 2 份是 AI 判满分自动通过的/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认发布' }));
  await waitFor(() => expect(calls.map((call) => call.key).filter((key) => key.startsWith('POST'))).toEqual([
    'POST /api/teacher/assignments/a_1/review/confirm-auto', 'POST /api/teacher/assignments/a_1/release',
  ]));
});

test('a teacher corrects an AI-drafted rubric and confirms it for everyone', async () => {
  window.history.pushState({}, '', '/assignments/a_1/review');
  const drafted = overview(1);
  const area = drafted.questions[1];
  Object.assign(area, { rubric_status: 'draft', rubric_source: 'ai', rubric_confirmed_by: null, rubric_applies_here: true,
    rubric_base: [{ label: '(1)', points: 5, criteria: ['写出公式得 2 分'] }, { label: '(2)', points: 7, criteria: ['方向正确'] }] });
  const calls = mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/review': () => ({ body: drafted }),
    'GET /api/teacher/assignments/a_1/review/2': () => ({ body: ENTRIES }),
    'PUT /api/teacher/assignments/a_1/review/2/rubric': () => ({ body: { applied: true, regrade: 2 } }),
  });
  render(<App />);
  expect(await screen.findByText('AI 起草，尚未有老师确认')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '修改并确认' }));
  expect(screen.getByText(/本次作业这道题的 AI 预批会按新细则重做/)).toBeInTheDocument();
  const points = screen.getByLabelText('第 1 部分分值');
  await userEvent.clear(points);
  await userEvent.type(points, '6');
  await userEvent.click(screen.getByRole('button', { name: '确认细则' }));
  const saved = calls.find((call) => call.key === 'PUT /api/teacher/assignments/a_1/review/2/rubric');
  expect(JSON.parse(String(saved?.init?.body))).toEqual({ parts: [
    { label: '(1)', points: 6, criteria: ['写出公式得 2 分'] }, { label: '(2)', points: 7, criteria: ['方向正确'] },
  ] });
  expect(await screen.findByRole('status')).toHaveTextContent('本题 2 份 AI 预批已按新细则退回');
});
