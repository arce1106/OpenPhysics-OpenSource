import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import type { Collection } from '../types';

const AUTH = {
  access_token: 'ready-token',
  teacher: { id: 't_1', username: 'wang', display_name: '王老师', must_change_password: false },
};

const DETAIL = {
  id: 'a_1', class_id: 'c_1', class_name: '高一(3)班', title: '运动学作业', kind: 'test', status: 'published',
  question_count: 3, total_points: 20, created_at: null, published_at: null, items: [],
};

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    assignment_id: 'a_1',
    collected: 1,
    total: 2,
    batches: [{ id: 'b_1', filename: '一班.pdf', status: 'done', error: null, page_count: 4, processed_pages: 4, created_at: null }],
    students: [
      {
        student_id: 's_1', display_name: 'Alice', student_number: '1', ai_authorized: true,
        submission: {
          id: 'sub_1', status: 'needs_review',
          items: [
            { number: 1, kind: 'choice', answer: 'A', recognized_answer: 'A', confidence: 0.95, is_correct: true, status: 'recognized', image_url: '/img/1' },
            { number: 2, kind: 'choice', answer: 'C', recognized_answer: 'C', confidence: 0.4, is_correct: false, status: 'needs_review', image_url: '/img/2' },
            { number: 4, kind: 'choice', answer: 'A', recognized_answer: 'A', confidence: 0.95, is_correct: false, partial: true, status: 'recognized', image_url: '/img/4' },
            { number: 3, kind: 'area', answer: null, recognized_answer: null, confidence: null, is_correct: null, status: 'collected', image_url: '/img/3' },
          ],
        },
      },
      { student_id: 's_2', display_name: 'Bob', student_number: '2', ai_authorized: false, submission: null },
    ],
    exceptions: [{
      page_id: 'p_9', page_index: 3, batch_id: 'b_1', kind: 'first', issue: 'unknown_number',
      issue_label: '学号不在本班名单中', recognized_number: '99', page_url: '/img/page', number_url: '/img/number',
    }],
    ai_usage: { calls: 3, input_tokens: 1200, output_tokens: 80, estimated_cost: 0 },
    ...overrides,
  };
}

function mockApi(handlers: Record<string, (init?: RequestInit) => { status?: number; body: unknown }>) {
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
  window.history.pushState({}, '', '/assignments/a_1/collect');
});

async function showTab(name: string) {
  const tabs = await screen.findByRole('navigation', { name: '收卷视图' });
  await userEvent.click(within(tabs).getByRole('button', { name: new RegExp(`^${name}`) }));
}

async function inspectAlice() {
  await userEvent.click(screen.getByRole('button', { name: '查看 Alice 的作答' }));
  return screen.getByRole('dialog', { name: 'Alice · 作答核对' });
}

test('keeps the workbench compact and opens answer details with image navigation', async () => {
  mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/collection': () => ({ body: collection() }),
  });
  render(<App />);

  expect(await screen.findByRole('heading', { name: '扫描收卷' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看已收学生' })).toHaveTextContent('1 / 2');
  expect(screen.getByText('完成，共 4 页')).toBeInTheDocument();
  expect(screen.queryByLabelText('Alice 第 2 题答案')).not.toBeInTheDocument();
  await showTab('待处理');
  const pending = screen.getByRole('region', { name: '待处理' });
  expect(within(pending).getByText('学号不在本班名单中')).toBeInTheDocument();
  expect(within(pending).getByRole('img', { name: '第 3 页学号' })).toHaveAttribute('src', '/img/number');
  const opener = screen.getByRole('button', { name: '查看 Alice 的作答' });
  const inspector = await inspectAlice();
  expect(within(inspector).getByLabelText('Alice 第 2 题答案').closest('label')).toHaveClass('flagged');
  expect(within(inspector).getByLabelText('Alice 第 1 题答案').closest('label')).not.toHaveClass('flagged');
  expect(within(inspector).getByTitle('少选：选对但不全，得一半分')).toHaveTextContent('半');
  await userEvent.click(within(inspector).getByRole('button', { name: '第 3 题' }));
  const viewer = screen.getByRole('dialog', { name: 'Alice 第 3 题作答' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(within(viewer).getByRole('img')).toHaveAttribute('src', '/img/3');
  await userEvent.click(within(viewer).getByRole('button', { name: '返回作答核对' }));
  expect(screen.getByLabelText('Alice 第 2 题答案')).toHaveValue('C');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  await showTab('未收学生');
  expect(screen.getByText('Bob')).toBeInTheDocument();
  expect(screen.queryByText('Alice')).not.toBeInTheDocument();
});

test('assigns an unmatched page and saves a choice without moving keyboard focus', async () => {
  const calls = mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/collection': () => ({ body: collection() }),
    'POST /api/teacher/scan-pages/p_9/assign': () => ({ status: 204, body: null }),
    'PUT /api/teacher/submissions/sub_1/choices/2': () => ({ status: 204, body: null }),
  });
  render(<App />);
  await showTab('待处理');
  const select = screen.getByLabelText('第 3 页对应的学生');
  expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['选择学生', '2 Bob']);
  await userEvent.selectOptions(select, 's_2');
  await userEvent.click(screen.getByRole('button', { name: '指定' }));
  const assign = calls.find((call) => call.key === 'POST /api/teacher/scan-pages/p_9/assign');
  expect(JSON.parse(String(assign?.init?.body))).toEqual({ student_id: 's_2', replace: false });
  await inspectAlice();
  const answer = screen.getByLabelText('Alice 第 2 题答案');
  await userEvent.clear(answer);
  await userEvent.type(answer, 'b');
  await userEvent.tab();
  const choice = calls.find((call) => call.key === 'PUT /api/teacher/submissions/sub_1/choices/2');
  expect(JSON.parse(String(choice?.init?.body))).toEqual({ answer: 'B' });
  expect(screen.getByLabelText('Alice 第 4 题答案')).toHaveFocus();
  expect(screen.getByLabelText('Alice 第 4 题答案')).not.toBeDisabled();
});

test('suggests doubtful numbers, replaces repeat copies, and confirms batch deletion', async () => {
  const calls = mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/collection': () => ({ body: collection({
      batches: [{ id: 'b_1', filename: '一班.pdf', status: 'done', error: null, page_count: 4, processed_pages: 4, created_at: null, copies: 1 }],
      exceptions: [
        { page_id: 'p_5', page_index: 5, batch_id: 'b_1', kind: 'first', issue: 'number_unsure', issue_label: '学号看不太清，请确认是谁',
          recognized_number: '2', number_confidence: 0.5, suggested: { student_id: 's_2', display_name: 'Bob' }, page_url: '/img/p5', number_url: '/img/n5' },
        { page_id: 'p_7', page_index: 7, batch_id: 'b_1', kind: 'first', issue: 'duplicate_copy', issue_label: '该学生已有一份卷子',
          recognized_number: '1', suggested: { student_id: 's_1', display_name: 'Alice' }, page_url: '/img/p7', number_url: '/img/n7' },
      ],
    }) }),
    'POST /api/teacher/scan-pages/p_5/assign': () => ({ status: 204, body: null }),
    'POST /api/teacher/scan-pages/p_7/assign': () => ({ status: 204, body: null }),
    'DELETE /api/teacher/scan-batches/b_1': () => ({ status: 204, body: null }),
  });
  render(<App />);
  await showTab('待处理');
  expect(screen.getByLabelText('第 5 页对应的学生')).toHaveValue('s_2');
  expect(screen.getByText(/把握 50%/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '指定' }));
  expect(JSON.parse(String(calls.find((c) => c.key === 'POST /api/teacher/scan-pages/p_5/assign')?.init?.body)))
    .toEqual({ student_id: 's_2', replace: false });
  expect(screen.getByLabelText('第 7 页对应的学生')).toHaveValue('s_1');
  await userEvent.click(screen.getByRole('button', { name: '用这份替换原卷' }));
  expect(JSON.parse(String(calls.find((c) => c.key === 'POST /api/teacher/scan-pages/p_7/assign')?.init?.body)))
    .toEqual({ student_id: 's_1', replace: true });
  await showTab('扫描记录');
  await userEvent.click(screen.getByRole('button', { name: '删除' }));
  const dialog = screen.getByRole('dialog', { name: '删除扫描记录' });
  expect(within(dialog).getByText('会同时删除其中 1 份卷子和已做的批改，确定？')).toBeInTheDocument();
  expect(calls.some((c) => c.key === 'DELETE /api/teacher/scan-batches/b_1')).toBe(false);
  await userEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
  expect(calls.some((c) => c.key === 'DELETE /api/teacher/scan-batches/b_1')).toBe(true);
});

test('released results allow inspection but lock collection changes', async () => {
  mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/collection': () => ({ body: collection({ released: true }) }),
  });
  render(<App />);
  expect(await screen.findByText(/收卷已锁定/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '导入扫描件' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  await showTab('已收学生');
  await inspectAlice();
  expect(screen.getByLabelText('Alice 第 2 题答案')).toHaveAttribute('readonly');
});

test('imports selected scans only on confirmation and without a JSON content type', async () => {
  const calls = mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/collection': () => ({ body: collection({ exceptions: [], batches: [] }) }),
    'POST /api/teacher/assignments/a_1/scans': () => ({ status: 202, body: { batch_id: 'b_2', created: true, status: 'queued' } }),
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '导入扫描件' }));
  const dialog = screen.getByRole('dialog', { name: '导入扫描件' });
  const file = new File(['%PDF-1.4'], '二班.pdf', { type: 'application/pdf' });
  await userEvent.upload(within(dialog).getByLabelText('选择扫描文件'), file);
  expect(calls.some((call) => call.key.endsWith('/scans'))).toBe(false);
  await userEvent.click(within(dialog).getByRole('button', { name: '导入并识别' }));
  const upload = calls.find((call) => call.key === 'POST /api/teacher/assignments/a_1/scans');
  expect(upload?.init?.body).toBeInstanceOf(FormData);
  expect((upload?.init?.body as FormData).get('file')).toBe(file);
  expect(new Headers(upload?.init?.headers).has('Content-Type')).toBe(false);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent('已导入 1 个文件');
});

test('retains files after a partial import failure and safely retries using server deduplication', async () => {
  let uploads = 0;
  mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/collection': () => ({ body: collection() }),
    'POST /api/teacher/assignments/a_1/scans': () => {
      uploads += 1;
      return uploads === 2 ? { status: 503, body: { detail: '稍后重试' } }
        : { status: 202, body: { batch_id: 'b_2', created: uploads !== 3, status: 'queued' } };
    },
  });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '导入扫描件' }));
  const dialog = screen.getByRole('dialog', { name: '导入扫描件' });
  await userEvent.upload(within(dialog).getByLabelText('选择扫描文件'), [
    new File(['%PDF-1'], '第一份.pdf', { type: 'application/pdf' }),
    new File(['%PDF-2'], '第二份.pdf', { type: 'application/pdf' }),
  ]);
  await userEvent.click(within(dialog).getByRole('button', { name: '导入并识别' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('稍后重试');
  expect(within(dialog).getByText(/已选 2 个文件/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: '导入并识别' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(uploads).toBe(4);
  expect(screen.getByRole('status')).toHaveTextContent('第一份.pdf 已经上传过');
});

test('opens scan thumbnails lazily, retries loading, and uses one dialog to view and return', async () => {
  let reads = 0;
  const calls = mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/collection': () => ({ body: collection() }),
    'GET /api/teacher/scan-batches/b_1/pages': () => {
      reads += 1;
      return reads === 1 ? { status: 503, body: { detail: '图像暂时不可用' } } : { body: {
        batch_id: 'b_1', filename: '一班.pdf', pages: [
          { id: 'p1', page_index: 1, status: 'ok', issue_label: null, student_name: 'Alice', student_number: '1', image_url: '/img/p1' },
        ],
      } };
    },
  });
  render(<App />);
  const opener = await screen.findByRole('button', { name: '查看图像' });
  expect(calls.some((call) => call.key.endsWith('/pages'))).toBe(false);
  await userEvent.click(opener);
  expect(await screen.findByRole('alert')).toHaveTextContent('图像暂时不可用');
  await userEvent.click(screen.getByRole('button', { name: '重试图像' }));
  await userEvent.click(await screen.findByRole('button', { name: '查看第 1 页' }));
  const viewer = screen.getByRole('dialog', { name: '第 1 页扫描图像' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(within(viewer).getByRole('img')).toHaveAttribute('src', '/img/p1');
  await userEvent.click(within(viewer).getByRole('button', { name: '返回图像列表' }));
  expect(screen.getByRole('dialog', { name: '一班.pdf · 扫描图像' })).toBeInTheDocument();
  const close = screen.getByRole('button', { name: '关闭' });
  close.focus();
  await userEvent.tab({ shift: true });
  expect(screen.getByRole('button', { name: '查看第 1 页' })).toHaveFocus();
  await userEvent.tab();
  expect(close).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(opener).toHaveFocus();
});

test('does not flag App text answers or carry the received filter into the missing list', async () => {
  const data = collection({ exceptions: [] });
  data.students[0].submission = { ...data.students[0].submission!, source: 'app', status: 'recognized', items: [
    { number: 1, kind: 'choice', answer: 'A', recognized_answer: null, confidence: null, is_correct: true, status: 'recognized', image_url: null },
    { number: 3, kind: 'area', answer: '受力分析', recognized_answer: null, confidence: null, is_correct: null, status: 'collected', image_url: null },
  ] };
  mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/collection': () => ({ body: data }),
  });
  render(<App />);
  await showTab('已收学生');
  await inspectAlice();
  expect(screen.getByText('第 3 题（App 文字作答）')).toBeInTheDocument();
  expect(screen.queryByText('第 3 题缺失')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Alice 第 1 题答案')).toHaveAttribute('readonly');
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('checkbox', { name: '只看需核对的' }));
  expect(screen.queryByRole('button', { name: '查看 Alice 的作答' })).not.toBeInTheDocument();
  await showTab('未收学生');
  expect(screen.getByText('Bob')).toBeInTheDocument();
});

test('shows a refused answer inside the inspector and restores the saved value', async () => {
  mockApi({
    'GET /api/teacher/assignments/a_1': () => ({ body: DETAIL }),
    'GET /api/teacher/assignments/a_1/collection': () => ({ body: collection() }),
    'PUT /api/teacher/submissions/sub_1/choices/2': () => ({ status: 409, body: { detail: '收卷已锁定' } }),
  });
  render(<App />);
  await showTab('已收学生');
  const inspector = await inspectAlice();
  const answer = within(inspector).getByLabelText('Alice 第 2 题答案');
  await userEvent.clear(answer);
  await userEvent.type(answer, 'B');
  await userEvent.tab();
  expect(await within(inspector).findByRole('alert')).toHaveTextContent('收卷已锁定');
  await waitFor(() => expect(answer).toHaveValue('C'));
});
