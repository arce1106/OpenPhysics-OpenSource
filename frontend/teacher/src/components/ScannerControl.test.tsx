import { act, fireEvent, render, screen, within } from '@testing-library/react';
import ScannerControl from './ScannerControl';
import { SCANNER_KEY, type ScannerStatus } from '../scanner';

const KEY = 'test-only-scanner-key-01234567890123456789';
const JOB = 'a'.repeat(32);
const READY: ScannerStatus = { protocol_version: 1, capabilities: ['pdf_stack_export'], state: 'idle', active: false, job_id: null, assignment_id: null, pages: 0, sheets: 0 };

function fakeScanner(options: { uploadFails?: boolean; otherAssignment?: boolean; intakeBusy?: boolean } = {}) {
  let status: ScannerStatus = options.otherAssignment ? { ...READY, state: 'scanning', active: true, assignment_id: 'a_other', job_id: JOB } : READY;
  let uploads = 0;
  let intakeReads = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input); calls.push({ url, init });
    const path = new URL(url, 'http://localhost').pathname;
    let body: unknown = {};
    if (path === '/v1/status') body = status;
    else if (path === '/v1/start') {
      status = { ...READY, state: 'paused_by_user', job_id: JOB, assignment_id: 'a_1', pages: 2, sheets: 1 };
      body = { protocol_version: 1, accepted: true };
    } else if (path === '/v1/exports') body = { job_id: JOB, assignment_id: 'a_1', exports: [{ stack: 1, page_count: 2, fingerprint: 'sha-first' }] };
    else if (path.endsWith('/collection')) {
      intakeReads += 1;
      body = { batches: options.intakeBusy && intakeReads === 1 ? [{ status: 'processing' }] : [], released: false };
    }
    else if (path.startsWith('/v1/export/')) return new Response('%PDF-1.4 test', { headers: { 'Content-Type': 'application/pdf' } });
    else if (path === '/api/teacher/assignments/a_1/scans') {
      uploads += 1;
      if (options.uploadFails && uploads === 1) return new Response(JSON.stringify({ detail: '上传网络中断' }), { status: 503 });
      body = { batch_id: 'b_1', created: uploads === 1, status: 'queued' };
    }
    return new Response(JSON.stringify(body));
  });
  return calls;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.setItem('openphysics:teacher:auth', JSON.stringify({ access_token: 'teacher-token', teacher: { id: 't_1' } }));
});
afterEach(() => { vi.useRealTimers(); });
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(1600); }); }
async function connect() {
  fireEvent.click(screen.getByRole('button', { name: '开始扫描' }));
  fireEvent.change(screen.getByLabelText('扫描工具连接码'), { target: { value: KEY } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '连接扫描工具' })); });
  return screen.getByRole('dialog', { name: '本机扫描' });
}

test('connection only reads status, keeps the key in session, and does not start hardware', async () => {
  const calls = fakeScanner();
  render(<ScannerControl assignmentId="a_1" locked={false} onImported={async () => undefined} />);
  await connect();
  expect(screen.getByText('就绪')).toBeInTheDocument();
  expect(calls.every((call) => new URL(call.url).pathname === '/v1/status')).toBe(true);
  expect(window.sessionStorage.getItem(SCANNER_KEY)).toBe(KEY);
  expect(window.localStorage.getItem(SCANNER_KEY)).toBeNull();
  expect(calls[0].init?.credentials).toBe('omit');
  expect(calls[0].init?.headers).toEqual({ Authorization: `Bearer ${KEY}` });
});

test('automatically uploads a whole committed stack once and separates local and cloud credentials', async () => {
  const calls = fakeScanner();
  const imported = vi.fn(async () => undefined);
  render(<ScannerControl assignmentId="a_1" locked={false} onImported={imported} />);
  const dialog = await connect();
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '开始扫描并上传' })); });
  expect(calls.find((call) => call.url.endsWith('/v1/start'))?.init?.body).toBe(JSON.stringify({ assignment_id: 'a_1' }));
  await tick();
  expect(screen.getByText(/已上传 2 面/)).toBeInTheDocument();
  const upload = calls.find((call) => call.url.includes('/scans?'));
  expect(upload?.url).toBe('/api/teacher/assignments/a_1/scans?auto_grade=true');
  expect(new Headers(upload?.init?.headers).get('Authorization')).toBe('Bearer teacher-token');
  expect(String(upload?.init?.body)).not.toContain(KEY);
  expect((upload?.init?.body as FormData).get('file')).toBeInstanceOf(File);
  expect(imported).toHaveBeenCalledTimes(1);
  await tick();
  expect(calls.filter((call) => call.url.includes('/scans?'))).toHaveLength(1);
});

test('a failed cloud upload keeps the pending stack for an explicit retry', async () => {
  const calls = fakeScanner({ uploadFails: true });
  render(<ScannerControl assignmentId="a_1" locked={false} onImported={async () => undefined} />);
  const dialog = await connect();
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '开始扫描并上传' })); });
  await tick();
  expect(within(dialog).getByRole('alert')).toHaveTextContent('上传网络中断');
  await tick();
  expect(calls.filter((call) => call.url.includes('/scans?'))).toHaveLength(1);
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '继续上传待传文件' })); });
  await tick();
  expect(calls.filter((call) => call.url.includes('/scans?'))).toHaveLength(2);
  expect(screen.getByText(/已上传 2 面/)).toBeInTheDocument();
});

test('does not read or upload another assignment and prevents starting over its active scan', async () => {
  const calls = fakeScanner({ otherAssignment: true });
  render(<ScannerControl assignmentId="a_1" locked={false} onImported={async () => undefined} />);
  const dialog = await connect();
  await tick();
  expect(within(dialog).getByText(/本机正在扫描其他任务/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: '开始扫描并上传' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: '暂停扫描' })).toBeDisabled();
  expect(calls.every((call) => new URL(call.url).pathname === '/v1/status')).toBe(true);
});

test('released collection has no scanner controls and never connects to loopback', () => {
  const calls = fakeScanner();
  window.sessionStorage.setItem(SCANNER_KEY, KEY);
  render(<ScannerControl assignmentId="a_1" locked onImported={async () => undefined} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(calls).toHaveLength(0);
});

test('waits for cloud intake before submitting a stack and respects manual pregrade selection', async () => {
  const calls = fakeScanner({ intakeBusy: true });
  render(<ScannerControl assignmentId="a_1" locked={false} onImported={async () => undefined} />);
  const dialog = await connect();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '上传后自动预批' }));
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '开始扫描并上传' })); });
  await tick();
  expect(calls.some((call) => call.url.includes('/scans'))).toBe(false);
  await tick();
  expect(calls.find((call) => call.url.endsWith('/scans'))?.url).toBe('/api/teacher/assignments/a_1/scans');
  expect(window.sessionStorage.getItem('openphysics:scanner:auto-grade')).toBe('false');
});
