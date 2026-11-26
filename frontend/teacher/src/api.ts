import type { RubricPart,
  ClassInvitation,
  ClassPracticeRecord,
  ClassStatistics,
  ScanBatchPages,
  AssignmentDetail,
  Collection,
  GradeInput,
  Report,
  ReviewEntry,
  ReviewOverview,
  AssignmentSummary,
  BankQuestion,
  ClassDashboard,
  ClassHomework,
  ItemInput,
  LibraryEntry,
  ScopeEntry,
  KnowledgePointOption,
  OutlineCounts,
  QuestionFilters,
  QuestionPage,
  TeacherAuth,
  TeacherClassDetail,
  TeacherClassSummary,
  TeacherProfile,
} from './types';

const AUTH_KEY = 'openphysics:teacher:auth';
export const AUTH_EXPIRED_EVENT = 'openphysics:teacher:auth-expired';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function readError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string') {
    return data.detail;
  }
  return fallback;
}

async function send(path: string, options?: RequestInit): Promise<Response> {
  const auth = getAuth();
  let response: Response;
  try {
    response = await fetch(`/api/teacher${path}`, {
      ...options,
      headers: {
        ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(auth ? { Authorization: `Bearer ${auth.access_token}` } : {}),
        ...(options?.headers || {}),
      },
    });
  } catch {
    throw new ApiError('网络连接失败，请稍后重试', 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 401 && auth) {
      clearAuth();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new ApiError(readError(data, `请求失败（${response.status}）`), response.status);
  }
  return response;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await send(path, options);
  return (response.status === 204 ? null : await response.json().catch(() => null)) as T;
}

function query(params: object): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function getAuth(): TeacherAuth | null {
  try {
    const raw = window.localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) as TeacherAuth : null;
  } catch {
    return null;
  }
}

export function saveAuth(auth: TeacherAuth) {
  window.localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function clearAuth() {
  window.localStorage.removeItem(AUTH_KEY);
  window.sessionStorage.removeItem('openphysics:scanner:key');
  window.sessionStorage.removeItem('openphysics:scanner:assignment');
  window.sessionStorage.removeItem('openphysics:scanner:auto-grade');
}

export const api = {
  login: (username: string, password: string) =>
    request<TeacherAuth>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request<TeacherProfile>('/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<TeacherAuth>('/me/password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),
  classes: () => request<TeacherClassSummary[]>('/classes'),
  classInvitation: (id: string) => request<ClassInvitation>(`/classes/${encodeURIComponent(id)}/invitation`),
  generateClassInvitation: (id: string) => request<ClassInvitation>(`/classes/${encodeURIComponent(id)}/invitation`, { method: 'POST' }),
  disableClassInvitation: (id: string) => request<ClassInvitation>(`/classes/${encodeURIComponent(id)}/invitation`, { method: 'DELETE' }),
  removeClassMember: (id: string, studentId: string) => request<TeacherClassDetail>(`/classes/${encodeURIComponent(id)}/members/${encodeURIComponent(studentId)}`, { method: 'DELETE' }),
  classDetail: (classId: string) => request<TeacherClassDetail>(`/classes/${encodeURIComponent(classId)}`),
  classDashboard: (classId: string) =>
    request<ClassDashboard>(`/classes/${encodeURIComponent(classId)}/dashboard`),
  classRecords: (classId: string, filters: { student_id?: string; kp_id?: string; wrong_only?: boolean; source?: 'practice' | 'homework' | 'all'; offset?: number }) =>
    request<{ items: ClassPracticeRecord[]; has_more: boolean }>(`/classes/${encodeURIComponent(classId)}/records${query(filters)}`),
  studentStatistics: (classId: string, studentId: string) =>
    request<ClassStatistics>(`/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}/statistics`),
  setMemberNumber: (classId: string, studentId: string, studentNumber: string | null) =>
    request<TeacherClassDetail>(
      `/classes/${encodeURIComponent(classId)}/members/${encodeURIComponent(studentId)}/number`,
      { method: 'PUT', body: JSON.stringify({ student_number: studentNumber }) },
    ),
  autoNumber: (classId: string) =>
    request<TeacherClassDetail>(`/classes/${encodeURIComponent(classId)}/members/auto-number`, { method: 'POST' }),
  knowledgePoints: () => request<KnowledgePointOption[]>('/knowledge-points'),
  outline: () => request<OutlineCounts>('/question-bank/outline'),
  /** Without a class, answer counts span all the teacher's classes. */
  searchQuestions: (classId: string | null, filters: QuestionFilters) =>
    request<QuestionPage>(`/questions${query({ class_id: classId, ...filters })}`),
  library: () => request<LibraryEntry[]>('/assignments'),
  createPaper: (title: string) =>
    request<AssignmentDetail>('/assignments', { method: 'POST', body: JSON.stringify({ title }) }),
  createPersonalizedFor: (data: {
    title: string; scope: ScopeEntry[]; choice_count: number; area_count?: number;
    experiment_count?: number; calculation_count?: number; class_ids: string[];
    student_ids_by_class?: Record<string, string[]>;
    delivery?: 'app' | 'paper';
  }) => request<{ paper: AssignmentSummary; assigned: AssignmentSummary[] }>('/personalized', {
    method: 'POST', body: JSON.stringify(data),
  }),
  assignTo: (assignmentId: string, classIds: string[], studentIdsByClass?: Record<string, string[]>, delivery?: 'app' | 'paper') =>
    request<{ assigned: AssignmentSummary[] }>(`/assignments/${encodeURIComponent(assignmentId)}/assign`, {
      method: 'POST', body: JSON.stringify({ class_ids: classIds, student_ids_by_class: studentIdsByClass, delivery }),
    }),
  /** Fixes a paper of the teacher's own as it will be printed; publishing then sends exactly it. */
  savePaper: (assignmentId: string) =>
    request<AssignmentDetail>(`/assignments/${encodeURIComponent(assignmentId)}/save`, { method: 'POST' }),
  copyAssignment: (assignmentId: string) =>
    request<AssignmentDetail>(`/assignments/${encodeURIComponent(assignmentId)}/copy`, { method: 'POST' }),
  classHomework: (classId: string) => request<ClassHomework>(`/classes/${encodeURIComponent(classId)}/homework`),
  assignments: (classId: string) =>
    request<AssignmentSummary[]>(`/classes/${encodeURIComponent(classId)}/assignments`),
  createAssignment: (classId: string, title: string) =>
    request<AssignmentDetail>(`/classes/${encodeURIComponent(classId)}/assignments`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  assignment: (assignmentId: string, statsClassId?: string | null) =>
    request<AssignmentDetail>(`/assignments/${encodeURIComponent(assignmentId)}${query({ stats_class_id: statsClassId })}`),
  assignmentPdf: async (assignmentId: string, edition: 'student' | 'teacher' = 'student') => {
    const response = await send(`/assignments/${encodeURIComponent(assignmentId)}/pdf${edition === 'teacher' ? '?edition=teacher' : ''}`);
    if (!response.headers.get('Content-Type')?.includes('application/pdf')) {
      throw new ApiError('PDF 生成失败，请重试', 502);
    }
    return response.blob();
  },
  updateAssignment: (assignmentId: string, data: { title?: string; items?: ItemInput[] }) =>
    request<AssignmentDetail>(`/assignments/${encodeURIComponent(assignmentId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteAssignment: (assignmentId: string) =>
    request<null>(`/assignments/${encodeURIComponent(assignmentId)}?scope=task`, { method: 'DELETE' }),
  createPersonalized: (classId: string, data: { title: string; scope: ScopeEntry[]; choice_count: number; area_count?: number; experiment_count?: number; calculation_count?: number }) =>
    request<AssignmentDetail>(`/classes/${encodeURIComponent(classId)}/personalized`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  redraftPaper: (assignmentId: string, studentId: string) =>
    request<AssignmentDetail>(
      `/assignments/${encodeURIComponent(assignmentId)}/papers/${encodeURIComponent(studentId)}/redraft`,
      { method: 'POST' },
    ),
  updatePaper: (assignmentId: string, studentId: string, data: { items?: ItemInput[]; delivery?: 'app' | 'paper' }) =>
    request<AssignmentDetail>(
      `/assignments/${encodeURIComponent(assignmentId)}/papers/${encodeURIComponent(studentId)}`,
      { method: 'PUT', body: JSON.stringify(data) },
    ),
  setDeliveryAll: (assignmentId: string, delivery: 'app' | 'paper') =>
    request<AssignmentDetail>(`/assignments/${encodeURIComponent(assignmentId)}/papers/delivery`, {
      method: 'PUT', body: JSON.stringify({ delivery }),
    }),
  paperAlternatives: (assignmentId: string, studentId: string, questionId: string) =>
    request<BankQuestion[]>(
      `/assignments/${encodeURIComponent(assignmentId)}/papers/${encodeURIComponent(studentId)}/alternatives${query({ question_id: questionId })}`,
    ),
  alternatives: (assignmentId: string, questionId: string) =>
    request<BankQuestion[]>(
      `/assignments/${encodeURIComponent(assignmentId)}/alternatives${query({ question_id: questionId })}`,
    ),
  publishAssignment: (assignmentId: string) =>
    request<AssignmentDetail>(`/assignments/${encodeURIComponent(assignmentId)}/publish`, { method: 'POST' }),
  collection: (assignmentId: string) => request<Collection>(`/assignments/${encodeURIComponent(assignmentId)}/collection`),
  uploadScan: (assignmentId: string, file: File, autoGrade = false) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ batch_id: string; created: boolean; status: string }>(
      `/assignments/${encodeURIComponent(assignmentId)}/scans${autoGrade ? '?auto_grade=true' : ''}`, { method: 'POST', body: form },
    );
  },
  scanBatchPages: (batchId: string) => request<ScanBatchPages>(`/scan-batches/${encodeURIComponent(batchId)}/pages`),
  deleteScanBatch: (batchId: string) =>
    request<null>(`/scan-batches/${encodeURIComponent(batchId)}`, { method: 'DELETE' }),
  assignScanPage: (pageId: string, studentId: string, replace = false) =>
    request<null>(`/scan-pages/${encodeURIComponent(pageId)}/assign`, {
      method: 'POST', body: JSON.stringify({ student_id: studentId, replace }),
    }),
  attachScanPage: (pageId: string, studentId: string) =>
    request<{ filled: number }>(`/scan-pages/${encodeURIComponent(pageId)}/attach`, {
      method: 'POST', body: JSON.stringify({ student_id: studentId }),
    }),
  retryScanBatch: (batchId: string) =>
    request<{ batch_id: string; status: string }>(`/scan-batches/${encodeURIComponent(batchId)}/retry`, { method: 'POST' }),
  ignoreScanPage: (pageId: string) =>
    request<null>(`/scan-pages/${encodeURIComponent(pageId)}/ignore`, { method: 'POST' }),
  setChoice: (submissionId: string, number: number, answer: string) =>
    request<null>(`/submissions/${encodeURIComponent(submissionId)}/choices/${number}`, {
      method: 'PUT', body: JSON.stringify({ answer }),
    }),
  startGrading: (assignmentId: string) =>
    request<{ run_id: string; total: number }>(`/assignments/${encodeURIComponent(assignmentId)}/grading`, { method: 'POST' }),
  review: (assignmentId: string) => request<ReviewOverview>(`/assignments/${encodeURIComponent(assignmentId)}/review`),
  reviewQuestion: (assignmentId: string, number: number) =>
    request<ReviewEntry[]>(`/assignments/${encodeURIComponent(assignmentId)}/review/${number}`),
  saveRubric: (assignmentId: string, number: number, parts: RubricPart[]) =>
    request<{ applied: boolean; regrade: number }>(`/assignments/${encodeURIComponent(assignmentId)}/review/${number}/rubric`, {
      method: 'PUT', body: JSON.stringify({ parts }),
    }),
  redraftRubric: (assignmentId: string, number: number) =>
    request<{ status: string }>(`/assignments/${encodeURIComponent(assignmentId)}/review/${number}/rubric/draft`, { method: 'POST' }),
  confirmAllAuto: (assignmentId: string) =>
    request<{ confirmed: number }>(`/assignments/${encodeURIComponent(assignmentId)}/review/confirm-auto`, { method: 'POST' }),
  confirmAuto: (assignmentId: string, number: number) =>
    request<{ confirmed: number }>(`/assignments/${encodeURIComponent(assignmentId)}/review/${number}/confirm-auto`, { method: 'POST' }),
  gradeItem: (itemId: number, data: GradeInput) =>
    request<null>(`/submission-items/${itemId}/grade`, { method: 'PUT', body: JSON.stringify(data) }),
  releaseResults: (assignmentId: string) =>
    request<null>(`/assignments/${encodeURIComponent(assignmentId)}/release`, { method: 'POST' }),
  report: (assignmentId: string) => request<Report>(`/assignments/${encodeURIComponent(assignmentId)}/report`),
  reportCsv: async (assignmentId: string) =>
    (await send(`/assignments/${encodeURIComponent(assignmentId)}/report.csv`)).blob(),
};
