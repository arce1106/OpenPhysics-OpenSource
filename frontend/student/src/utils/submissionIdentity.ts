import { sha256 } from './sha256';
const PREFIX = 'openphysics:pending-submission:v1:';
const PENDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
interface PendingIdentity {
  id: string;
  expiresAt: number;
}
const pending = new Map<string, PendingIdentity>();
function readPending(value: string | null): PendingIdentity | null {
  try {
    const item = JSON.parse(value || 'null');
    return typeof item?.id === 'string' && item.expiresAt > Date.now() ? item : null;
  }
  catch {
    return null;
  }
}
export function newSubmissionId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `submission-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
export function pendingSubmissionId(key: string, explicitId?: string) {
  if (explicitId)
    return explicitId;
  const shortKey = sha256(key);
  let saved: PendingIdentity | null = null;
  try {
    Object.keys(localStorage).filter(item => item.startsWith(PREFIX)).forEach(item => {
      if (!readPending(localStorage.getItem(item)))
        localStorage.removeItem(item);
    });
    saved = readPending(localStorage.getItem(PREFIX + shortKey));
  }
  catch { /* Memory fallback below. */ }
  for (const [item, value] of pending)
    if (value.expiresAt <= Date.now())
      pending.delete(item);
  const record = saved || pending.get(shortKey) || { id: newSubmissionId(), expiresAt: Date.now() + PENDING_RETENTION_MS };
  pending.set(shortKey, record);
  try {
    localStorage.setItem(PREFIX + shortKey, JSON.stringify(record));
  }
  catch {
    window.dispatchEvent(new CustomEvent('openphysics:save-error'));
  }
  return record.id;
}
// The attempt itself rotates only on an explicit new practice. No pending entry is
// needed: even an unknown response retried after a reload gets the same identity.
export function attemptSubmissionId(key: string) {
  return `practice-${sha256(key)}`;
}
export function completeSubmission(key: string, id: string) {
  // An older concurrent response must not remove a newer attempt's identity.
  const shortKey = sha256(key);
  if (pending.get(shortKey)?.id === id)
    pending.delete(shortKey);
  try {
    if (readPending(localStorage.getItem(PREFIX + shortKey))?.id === id)
      localStorage.removeItem(PREFIX + shortKey);
  }
  catch { /* The current request has already completed. */ }
}
export function readBlobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取作答图片，请重新选择'));
    reader.readAsDataURL(blob);
  });
}
export async function blobFingerprint(blob: Blob): Promise<string> {
  const content = await readBlobDataUrl(blob);
  if (!crypto.subtle)
    return sha256(content);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
