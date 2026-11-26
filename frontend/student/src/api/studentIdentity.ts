const STORAGE_KEY = 'openphysics.student_id';
const TOKEN_KEY = 'openphysics.student_token';
const STUDENT_KEY = 'openphysics.student_profile';
const DEFAULT_STUDENT_ID = 'default';
export const STUDENT_SESSION_CHANGED_EVENT='openphysics:student-session-changed';
export const STUDENT_ACCESS_REFRESH_EVENT = 'openphysics:student-access-refresh';

function sanitizeStudentId(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[^\w.-]/g, '_').slice(0, 64) || null;
}

export function getStudentId(): string {
  if (typeof window === 'undefined') return DEFAULT_STUDENT_ID;

  if(getStudentToken()) {
    const authenticatedId=sanitizeStudentId(getStudentProfile()?.id || null);
    if(authenticatedId)return authenticatedId;
  }

  const params = new URLSearchParams(window.location.search);
  const fromUrl = sanitizeStudentId(params.get('student_id') || params.get('student'));
  if (fromUrl) {
    window.localStorage.setItem(STORAGE_KEY, fromUrl);
    return fromUrl;
  }

  const stored = sanitizeStudentId(window.localStorage.getItem(STORAGE_KEY));
  if (stored) return stored;

  window.localStorage.setItem(STORAGE_KEY, DEFAULT_STUDENT_ID);
  return DEFAULT_STUDENT_ID;
}

export function setStudentId(studentId: string): string {
  const normalized = sanitizeStudentId(studentId) || DEFAULT_STUDENT_ID;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, normalized);
  }
  return normalized;
}

export interface StudentProfile {
  id: string;
  username: string;
  phone?: string | null;
  display_name: string;
  class_name?: string | null;
  grade?: string | null;
  account_source?: string;
  status: string;
}

export function getStudentToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(TOKEN_KEY) || '';
}

export function setStudentSession(token: string, student: StudentProfile) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
  setStudentProfile(student);
  window.dispatchEvent(new CustomEvent(STUDENT_SESSION_CHANGED_EVENT));
}

export function setStudentProfile(student: StudentProfile) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STUDENT_KEY, JSON.stringify(student));
  setStudentId(student.id);
}

export function getStudentProfile(): StudentProfile | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STUDENT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StudentProfile;
  } catch {
    return null;
  }
}

export function clearStudentSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(STUDENT_KEY);
  window.dispatchEvent(new CustomEvent(STUDENT_SESSION_CHANGED_EVENT));
}
