const BASE = '/api/admin';
const ADMIN_TOKEN_KEY = 'openphysics_admin_token';
export const ADMIN_AUTH_EXPIRED_EVENT = 'openphysics_admin_auth_expired';

function adminHeaders(extra?: HeadersInit): HeadersInit {
  const token = window.localStorage.getItem(ADMIN_TOKEN_KEY) || '';
  return {
    ...(extra || {}),
    ...(token && { 'X-Admin-Token': token }),
  };
}

export function getAdminToken(): string {
  return window.localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export function setAdminToken(token: string): void {
  window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((d: any) => d.msg || JSON.stringify(d)).join('; ');
    return JSON.stringify(data);
  } catch {
    return `${res.status} ${res.statusText}`.trim();
  }
}

function isAuthEndpoint(path: string): boolean {
  return path.startsWith('/auth/login');
}

async function ensureOk(res: Response, path: string): Promise<void> {
  if (res.ok) return;
  if (res.status === 401 && !isAuthEndpoint(path)) {
    clearAdminToken();
    window.dispatchEvent(new CustomEvent(ADMIN_AUTH_EXPIRED_EVENT));
    throw new Error('管理员登录已失效，请重新登录后再操作');
  }
  throw new Error(await readError(res));
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: adminHeaders() });
  await ensureOk(res, path);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  await ensureOk(res, path);
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  await ensureOk(res, path);
  return res.json();
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: adminHeaders() });
  await ensureOk(res, path);
}

export const api = {
  loginAdmin: (username: string, password: string) =>
    post<import('../types').AdminLoginResponse>('/auth/login', { username, password }),
  getAdminMe: () =>
    get<import('../types').AdminMe>('/auth/me'),
  listKnowledgePointsWithStats: () =>
    get<import('../types').KpWithStats[]>('/knowledge/points/with-stats'),
  // Questions
  listQuestionsPaged: (params?: Record<string, string>) =>
    get<import('../types').QuestionPage>('/questions/paged', params),
  updateQuestion: (id: string, data: Record<string, unknown>) =>
    put<{ id: string; answer: string | null; explanation: string | null }>(`/questions/${id}`, data),
  reviewQuestion: (id: string, status: string) =>
    put(`/questions/${id}/review`, { status }),
  deleteQuestion: (id: string) => del(`/questions/${id}`),
  uploadQuestionVideo: async (id: string, file: File, title: string): Promise<import('../types').QuestionVideo> => {
    const path = `/questions/${encodeURIComponent(id)}/video`;
    const body = new FormData();
    body.append('file', file);
    body.append('title', title);
    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: adminHeaders(), body });
    await ensureOk(res, path);
    return res.json();
  },
  reviewQuestionVideo: (id: string, status: 'draft' | 'approved') =>
    put<import('../types').QuestionVideo>(`/questions/${encodeURIComponent(id)}/video/status`, { status }),
  previewQuestionVideo: (id: string) =>
    post<{ video_url: string }>(`/questions/${encodeURIComponent(id)}/video/preview`, {}),
  // Labels
  updateQuestionLabels: (id: string, labels: Record<string, unknown>[]) =>
    put(`/questions/${id}/labels`, { labels }),
  // Batch Review
  batchReview: (questionIds: string[], status: string) =>
    post<{ updated: number; errors: { id: string; error: string }[] }>(
      '/questions/batch-review',
      { question_ids: questionIds, status }
    ),
  getQualityReport: (params?: Record<string, string>) =>
    get<import('../types').QualityReport>('/quality/report', params),
  getLearningResources: (params?: Record<string, string>) =>
    get<import('../types').LearningResourceReport>('/learning/resources', params),
  listLearningVideos: (kpId: string) =>
    get<import('../types').LearningVideoCuration[]>('/learning/videos', { kp_id: kpId }),
  createLearningVideo: (data: import('../types').LearningVideoCurationPayload) =>
    post<import('../types').LearningVideoCuration>('/learning/videos', data),
  updateLearningVideo: (id: number, data: import('../types').LearningVideoCurationPayload) =>
    put<import('../types').LearningVideoCuration>(`/learning/videos/${id}`, data),
  deleteLearningVideo: (id: number) =>
    del(`/learning/videos/${id}`),
  getTeachingDashboard: (className?: string) =>
    get<import('../types').TeachingDashboard>(
      '/teaching/dashboard',
      className ? { class_name: className } : undefined
    ),
  getTeachingInsights: (options: { classId?: string; includeInternal?: boolean } = {}) =>
    get<import('../types').TeachingInsights>('/teaching/insights', {
      ...(options.classId ? { class_id: options.classId } : {}),
      ...(options.includeInternal ? { include_internal: 'true' } : {}),
    }),
  // Image management
  deleteQuestionImage: (questionId: string, imageId: string) =>
    del(`/questions/${questionId}/images/${imageId}`),
  updateQuestionImage: (questionId: string, imageId: string, data: Record<string, unknown>) =>
    put<import('../types').QuestionImage>(`/questions/${questionId}/images/${imageId}`, data),
  // Students
  listStudents: () =>
    get<import('../types').Student[]>('/students'),
  createStudent: (data: {
    username: string;
    password: string;
    display_name?: string;
    class_name?: string;
    status?: string;
  }) =>
    post<import('../types').Student>('/students', data),
  updateStudent: (id: string, data: {
    display_name?: string;
    class_name?: string;
    status?: string;
  }) =>
    put<import('../types').Student>(`/students/${id}`, data),
  resetStudentPassword: (id: string, password: string) =>
    post<{ reset: boolean; student: import('../types').Student }>(
      `/students/${id}/reset-password`,
      { password }
    ),
  resetStudentAccount: (id: string) =>
    post<{
      reset: boolean;
      student: import('../types').Student;
      deleted: Record<string, number>;
    }>(
      `/students/${id}/reset-account`,
      { confirm: 'RESET' }
    ),
  // Teachers and classes
  listTeachers: () =>
    get<import('../types').AdminTeacher[]>('/teachers'),
  createTeacher: (data: { username: string; display_name: string; password: string }) =>
    post<import('../types').AdminTeacher>('/teachers', data),
  updateTeacher: (id: string, data: { display_name?: string; status?: 'active' | 'disabled' }) =>
    put<import('../types').AdminTeacher>(`/teachers/${id}`, data),
  resetTeacherPassword: (id: string, password: string) =>
    post<import('../types').AdminTeacher>(`/teachers/${id}/reset-password`, { password }),
  createTeacherClass: (
    teacherId: string,
    data: { name: string; grade?: string; level: import('../types').TeacherClassLevel },
  ) => post<import('../types').AdminTeacherClass>(`/teachers/${teacherId}/classes`, data),
  updateTeacherClass: (classId: string, data: { archived?: boolean }) =>
    put<import('../types').AdminTeacherClass>(`/teacher-classes/${classId}`, data),
  listClassMembers: (classId: string) =>
    get<import('../types').AdminClassMember[]>(`/teacher-classes/${classId}/members`),
  /** Placing a student by hand needs a school's or guardian's authorization: the teacher sees their learning data. */
  addClassMember: (classId: string, username: string, grantor: 'school' | 'guardian') =>
    post<{ member: import('../types').AdminClassMember; added: boolean }>(
      `/teacher-classes/${classId}/members`,
      { username, grantor },
    ),
  recordAiAuthorization: (
    classId: string,
    data: { student_ids: string[]; granted: boolean; grantor: 'school' | 'guardian' },
  ) => post<import('../types').AdminClassMember[]>(`/teacher-classes/${classId}/ai-authorization`, data),
  removeClassMember: (classId: string, studentId: string) =>
    del(`/teacher-classes/${classId}/members/${studentId}`),
};
