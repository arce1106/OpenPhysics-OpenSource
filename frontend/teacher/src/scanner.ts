/** The scanner credential is sent only to this fixed loopback endpoint. */
const BASE = 'http://127.0.0.1:18765';
export const SCANNER_KEY = 'openphysics:scanner:key';
export const SCANNER_ASSIGNMENT = 'openphysics:scanner:assignment';

export interface ScannerStatus {
  protocol_version: number;
  capabilities?: string[];
  state: string;
  active: boolean;
  job_id: string | null;
  assignment_id: string | null;
  pages: number;
  sheets: number;
  message?: string;
}
export interface ScannerExport {
  stack: number;
  page_count: number;
  fingerprint: string;
}
export interface ScannerExports { job_id: string; assignment_id: string; exports: ScannerExport[] }
export class ScannerError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

async function call<T>(key: string, path: string, body?: object, binary = false): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), binary ? 90000 : 8000);
  try {
    // Modern browsers gate access to loopback with the local-network permission.
    const options: RequestInit & { targetAddressSpace: 'loopback' } = {
      method: body ? 'POST' : 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal, targetAddressSpace: 'loopback',
    };
    const response = await fetch(`${BASE}${path}`, options);
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new ScannerError(error?.message || '扫描工具请求失败，请检查本机工具。', response.status);
    }
    return (binary ? await response.blob() : await response.json()) as T;
  } catch (error) {
    if (error instanceof ScannerError) throw error;
    throw new ScannerError('未能连接本机扫描工具。请打开华高本地扫描 0.5.0，并允许浏览器访问本地网络。');
  } finally { window.clearTimeout(timer); }
}

export const scanner = {
  status: (key: string) => call<ScannerStatus>(key, '/v1/status'),
  start: (key: string, assignmentId: string) => call(key, '/v1/start', { assignment_id: assignmentId }),
  pause: (key: string, assignmentId: string) => call(key, '/v1/pause', { assignment_id: assignmentId }),
  exports: (key: string, jobId: string, assignmentId: string) => call<ScannerExports>(key,
    `/v1/exports?${new URLSearchParams({ job_id: jobId, assignment_id: assignmentId })}`),
  pdf: (key: string, jobId: string, assignmentId: string, stack: number) => call<Blob>(key,
    `/v1/export/${encodeURIComponent(jobId)}/${stack}?${new URLSearchParams({ assignment_id: assignmentId })}`, undefined, true),
};
