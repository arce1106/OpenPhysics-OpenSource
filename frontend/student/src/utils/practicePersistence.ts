import type { SubmitResult } from '../types';
import type { HandwritingSnapshot } from '../components/handwriting/HandwritingCanvas';
import type { SelfReviewDraft } from './selfReview';
import { newSubmissionId, readBlobDataUrl } from './submissionIdentity';
const PREFIX = 'openphysics:practice:v1:';
const DRAFT_PREFIX = 'openphysics:practice-drafts:v1:';
const RESULT_PREFIX = 'openphysics:practice-results:v1:';
const discardedAttempts = new Set<string>();
let saveErrorReported = false;
export const PRACTICE_SAVE_ERROR = 'openphysics:save-error';
export const PRACTICE_SAVE_WARNING = '当前设备未能保存练习进度，请保持此页面打开并完成提交后再离开。';
export interface PracticeRecord {
  version: 1;
  id: string;
  studentId: string;
  scope: string;
  payload: Record<string, unknown>;
  answers: Record<string, SubmitResult>;
  collectedAnswers: Record<string, string>;
  currentIdx: number;
}
export interface PracticeDrafts {
  answers: Record<string, string>;
  photos: Record<string, File>;
  handwriting: Record<string, HandwritingSnapshot>;
  selfReviews: Record<string, SelfReviewDraft>;
  backgrounds: Record<string, string | null>;
  metadata?: Record<string, unknown>;
}
export async function discardPracticeAttempt(key: string, throwOnError = false) {
  discardedAttempts.add(key);
  await Promise.allSettled([writes.get(key), writes.get(key + ':paper')]);
  try {
    // Remove only the matching session; completed answers remain on the server.
    for (const storageKey of Object.keys(localStorage)) {
      if (!storageKey.startsWith(PREFIX)) continue;
      let record: PracticeRecord | null = null;
      try { record = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { continue; }
      if (record && `${record.studentId}:${record.id}` === key) localStorage.removeItem(storageKey);
    }
    localStorage.removeItem(RESULT_PREFIX + key);
    localStorage.removeItem(DRAFT_PREFIX + key);
    localStorage.removeItem(DRAFT_PREFIX + key + ':paper');
    if (typeof indexedDB !== 'undefined') {
      const db = await openDraftDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('drafts', 'readwrite');
          tx.objectStore('drafts').delete(key);
          tx.objectStore('drafts').delete(key + ':paper');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      }
      finally {
        db.close();
      }
    }
  }
  catch (error) {
    reportPracticeSaveError();
    if (throwOnError) {
      discardedAttempts.delete(key);
      throw error;
    }
  }
}
export function newPracticeRecord(studentId: string, scope: string, payload: Record<string, unknown> = {}): PracticeRecord {
  return { version: 1, id: newSubmissionId(), studentId, scope, payload, answers: {}, collectedAnswers: {}, currentIdx: 0 };
}
export function loadPracticeRecord(studentId: string, scope: string): PracticeRecord | null {
  try {
    const data = JSON.parse(localStorage.getItem(PREFIX + JSON.stringify([studentId, scope])) || 'null');
    return data?.version === 1 && data.studentId === studentId && data.scope === scope
      && typeof data.id === 'string' && data.answers && data.payload && data.collectedAnswers
      && Number.isInteger(data.currentIdx) && data.currentIdx >= 0
      ? { ...data, answers: { ...data.answers, ...loadAttemptResults(`${studentId}:${data.id}`) } } : null;
  }
  catch {
    return null;
  }
}
export function loadAttemptResults(key: string): Record<string, SubmitResult> {
  try {
    return JSON.parse(localStorage.getItem(RESULT_PREFIX + key) || '{}');
  }
  catch {
    return {};
  }
}
export function saveAttemptResult(key: string, questionId: string, result: SubmitResult) {
  if (discardedAttempts.has(key))
    return;
  try {
    localStorage.setItem(RESULT_PREFIX + key, JSON.stringify({ ...loadAttemptResults(key), [questionId]: result }));
  }
  catch {
    reportPracticeSaveError();
  }
}
export function reportPracticeSaveError() {
  saveErrorReported = true;
  window.dispatchEvent(new CustomEvent(PRACTICE_SAVE_ERROR));
}
export function hasPracticeSaveError() {
  return saveErrorReported;
}
export function savePracticeRecord(record: PracticeRecord): boolean {
  if (discardedAttempts.has(`${record.studentId}:${record.id}`)) return false;
  try {
    localStorage.setItem(PREFIX + JSON.stringify([record.studentId, record.scope]), JSON.stringify(record));
    return true;
  }
  catch {
    reportPracticeSaveError();
    return false;
  }
}
function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('openphysics-practice-drafts', 1);
    let settled = false;
    const fail = (error: unknown) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = window.setTimeout(() => fail(new Error('草稿存储未响应')), 3000);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(request.result);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error('草稿存储暂不可用'));
  });
}
async function draftTransaction<T>(key: string, value?: PracticeDrafts): Promise<T | null> {
  const db = await openDraftDatabase();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction('drafts', value ? 'readwrite' : 'readonly');
      const store = tx.objectStore('drafts');
      const request = value ? store.put(value, key) : store.get(key);
      tx.oncomplete = () => resolve(value ? null : request.result || null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('草稿保存中断'));
    });
  }
  finally {
    db.close();
  }
}
// Serialize saves per attempt: a slow photo conversion must not overwrite a newer draft.
const writes = new Map<string, Promise<void>>();
export async function flushPracticeDraftWrites() {
  await Promise.allSettled([...writes.values()]);
}
export function savePracticeDrafts(key: string, draft: PracticeDrafts): Promise<void> {
  const discarded = () => discardedAttempts.has(key) || discardedAttempts.has(key.replace(/:paper$/, ''));
  if (discarded())
    return Promise.resolve();
  const write = (writes.get(key) || Promise.resolve()).catch(() => { }).then(async () => {
    if (discarded())
      return;
    if (typeof indexedDB !== 'undefined') {
      await draftTransaction(key, draft);
      return;
    }
    const photos = Object.fromEntries(await Promise.all(Object.entries(draft.photos).map(async ([id, file]) => [
      id, { name: file.name, type: file.type, lastModified: file.lastModified, data: await readBlobDataUrl(file) },
    ])));
    if (discarded())
      return;
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ ...draft, photos }));
  }).catch(error => {
    reportPracticeSaveError();
    throw error;
  });
  writes.set(key, write);
  void write.finally(() => {
    if (writes.get(key) === write) writes.delete(key);
  }).catch(() => {});
  return write;
}
export async function loadPracticeDrafts(key: string): Promise<PracticeDrafts | null> {
  await writes.get(key)?.catch(() => { });
  if (typeof indexedDB !== 'undefined')
    return draftTransaction<PracticeDrafts>(key);
  const stored = JSON.parse(localStorage.getItem(DRAFT_PREFIX + key) || 'null');
  if (!stored)
    return null;
  const photos = Object.fromEntries(Object.entries(stored.photos || {}).map(([id, value]) => {
    const file = value as {
      name: string;
      type: string;
      lastModified: number;
      data: string;
    };
    const bytes = Uint8Array.from(atob(file.data.split(',')[1]), char => char.charCodeAt(0));
    return [id, new File([bytes], file.name, { type: file.type, lastModified: file.lastModified })];
  }));
  return { ...stored, photos };
}
