import type { TopicPracticeContext } from '../types';
import type { AnswerHistoryItem, DashboardData, TrainStartData, ReviewData, RetryData, PracticeSession, SubmitResult, LearnBundle, LearnCompleteResult, DirectoryData, LearningCatalogData, LearningCatalogResume, LearningCatalogTopicLayer, LearningCatalogTopicOverview, KpDiagnosticResult, ScopeDiagnosticResult, ScopeDiagnosticAttemptDetail, ScopeDiagnosticAttemptListResponse, StudentCaptchaResponse, StudentLoginResponse, StudentProfile, VariationData, VideoRecommendationResponse, PhysicsSimulationResponse, PaperBatchGradeResponse, DailyLearningLoop, DailyLearningLoopHistory, GrowthReportResponse, ChatMessage, ImprovementPlan, ImprovementRecommendedAction, ImprovementReport, ImprovementReportListResponse, ImprovementRetestResult, ImprovementRetestSession, ImprovementTaskStatus, LearningTraceEvent, LearningTraceResponse, KnowledgeMasteryEvidence, KnowledgeMasteryJudgment, KnowledgeMasteryJudgmentBatchResponse, ScopeKnowledgeMasteryJudgmentResponse, SubmittedDiagnosticAnswer } from '../types';
import { apiUrl, buildStudentApiUrl } from './baseUrl';
import { clearStudentSession, getStudentId, getStudentToken, setStudentSession, STUDENT_ACCESS_REFRESH_EVENT } from './studentIdentity';
import { attemptSubmissionId, blobFingerprint, completeSubmission, pendingSubmissionId } from '../utils/submissionIdentity';
import {saveAttemptResult} from '../utils/practicePersistence';
import type { AccountCredentialsSettings, TeacherHomework, StudentClass, StudentClassPreview } from '../types';

const DIRECTORY_TTL_MS = 5 * 60 * 1000;
const SHORT_TTL_MS = 2 * 60 * 1000;
const STUDENT_CACHE_PREFIX = 'openphysics:student-api:';
const GET_TRANSIENT_RETRY_DELAYS_MS = [250, 750];

const getCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightGets = new Map<string, Promise<unknown>>();

async function runIdempotentSubmission<T>(
  key: string,
  explicitId: string | undefined,
  request: (submissionId: string) => Promise<T>,
  ): Promise<T> {
  const submissionId = pendingSubmissionId(key, explicitId);
  try {
    const result = await request(submissionId);
    completeSubmission(key, submissionId);
    return result;
  } catch (error) {
    throw error;
  }
}

function buildUrl(path: string, params?: Record<string, string>): string {
  return buildStudentApiUrl(path, params);
}

function clearStudentApiCache() {
  getCache.clear();
  inFlightGets.clear();
  try {
    Object.keys(window.sessionStorage)
      .filter(key => key.startsWith(STUDENT_CACHE_PREFIX))
      .forEach(key => window.sessionStorage.removeItem(key));
  } catch {
    // sessionStorage can be unavailable in private or restricted contexts.
  }
}

function cacheKey(path: string, params?: Record<string, string>): string {
  return `${getStudentId()}|${buildUrl(path, params)}`;
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getStudentToken();
  return {
    ...(extra || {}),
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getStudentToken();
  const response = await fetch(url, { ...options, headers: authHeaders(options.headers) });
  if (response.status === 401 && getStudentToken() === token) {
    clearStudentApiCache();
    clearStudentSession();
  }
  if (response.status === 402 && token && getStudentToken() === token) {
    // Refresh entitlements, but never log out or replay a rejected submission.
    window.dispatchEvent(new CustomEvent(STUDENT_ACCESS_REFRESH_EVENT));
  }
  return response;
}

function isTransientFetchError(error: unknown): boolean {
  return error instanceof TypeError && /failed to fetch/i.test(error.message);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data.detail === 'string') return data.detail;
    return JSON.stringify(data);
  } catch {
    return `API error: ${res.status}`;
  }
}

async function authError(res: Response): Promise<Error> {
  return Object.assign(new Error(await readError(res)), {
    status: res.status,
    captchaRequired: res.headers.get('X-Login-Captcha-Required') === 'true',
    retryAfter: Math.min(86400, Math.max(0, Number(res.headers.get('Retry-After')) || 0)),
  });
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = buildUrl(path, params);
  const requestToken=getStudentToken();
  let lastTransientError: unknown;

  for (let attempt = 0; attempt <= GET_TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      if(getStudentToken()!==requestToken)throw new Error('登录状态已改变，请重新进入当前页面');
      const res = await authenticatedFetch(url);
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    } catch (error) {
      if (!isTransientFetchError(error) || attempt >= GET_TRANSIENT_RETRY_DELAYS_MS.length) {
        throw error;
      }
      lastTransientError = error;
      await wait(GET_TRANSIENT_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastTransientError;
}

async function getOptional<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const res = await authenticatedFetch(buildUrl(path, params));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

async function cachedGet<T>(path: string, params: Record<string, string> | undefined, ttlMs: number): Promise<T> {
  const key = cacheKey(path, params);
  const now = Date.now();
  const cached = getCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }
  const persisted = readPersistedGet<T>(key, now);
  if (persisted) {
    getCache.set(key, persisted);
    return persisted.value;
  }
  const inFlight = inFlightGets.get(key);
  if (inFlight) {
    return inFlight as Promise<T>;
  }
  const request = get<T>(path, params)
    .then(data => {
      const entry = { value: data, expiresAt: Date.now() + ttlMs };
      getCache.set(key, entry);
      writePersistedGet(key, entry);
      return data;
    })
    .finally(() => {
      inFlightGets.delete(key);
    });
  inFlightGets.set(key, request);
  return request;
}

function readPersistedGet<T>(key: string, now: number): { expiresAt: number; value: T } | null {
  try {
    const raw = window.sessionStorage.getItem(`${STUDENT_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt: number; value: T };
    if (!parsed.expiresAt || parsed.expiresAt <= now) {
      window.sessionStorage.removeItem(`${STUDENT_CACHE_PREFIX}${key}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedGet(key: string, entry: { expiresAt: number; value: unknown }) {
  try {
    window.sessionStorage.setItem(`${STUDENT_CACHE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // Keep memory cache even if storage quota is full.
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await authenticatedFetch(apiUrl(path), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  clearStudentApiCache();
  return data;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await authenticatedFetch(apiUrl(path), {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  clearStudentApiCache();
  return data;
}

type BackendImprovementTaskResponse = {
  id: string;
  plan_id: string;
  student_id: string;
  kp_id: string;
  kp_name: string;
  group_id?: string | null;
  group_name?: string | null;
  correct_count: number;
  total_count: number;
  mastery_before: number;
  mastery_after: number;
  is_weak: boolean;
  priority: number;
  status: ImprovementTaskStatus;
  recommended_action: ImprovementRecommendedAction;
  reason: string;
  started_at?: string | null;
  practiced_at?: string | null;
  passed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type BackendImprovementPlanResponse = {
  id: string;
  student_id: string;
  diagnostic_attempt_id?: string | null;
  scope_type: 'chapter' | 'section';
  scope_id: string;
  scope_name: string;
  created_at: string;
  updated_at?: string | null;
  completed_at?: string | null;
  correct_count: number;
  total_count: number;
  weak_count: number;
  status: ImprovementPlan['status'];
  current_task_id?: string | null;
  source_result?: ScopeDiagnosticResult | null;
  tasks: BackendImprovementTaskResponse[];
};

type BackendScopeDiagnosticAttemptKpResult = {
  id: string;
  kp_id: string;
  kp_name: string;
  group_id?: string | null;
  group_name?: string | null;
  correct_count: number;
  total_count: number;
  mastery_before: number;
  mastery_after: number;
  is_weak: boolean;
};

type BackendScopeDiagnosticAttemptListItem = {
  attempt_id: string;
  scope_type: 'chapter' | 'section';
  scope_id: string;
  scope_name: string;
  diagnostic_type: string;
  created_at: string;
  submitted_at: string;
  correct_count: number;
  total_count: number;
  weak_count: number;
  recommendation?: 'study' | 'practice' | 'mastered' | null;
  feedback?: string | null;
  linked_plan_id?: string | null;
  linked_plan_status?: string | null;
  linked_report_available: boolean;
};

type BackendScopeDiagnosticAttemptListResponse = {
  items?: BackendScopeDiagnosticAttemptListItem[];
  total: number;
  limit: number;
  offset: number;
};

type BackendScopeDiagnosticAttemptDetail = {
  attempt_id: string;
  student_id: string;
  scope_type: 'chapter' | 'section';
  scope_id: string;
  scope_name: string;
  diagnostic_type: string;
  status: string;
  created_at: string;
  submitted_at: string;
  question_ids: string[];
  answer_ids: Array<number | string>;
  result?: Record<string, unknown> | null;
  correct_count: number;
  total_count: number;
  weak_count: number;
  weak_kp_ids: string[];
  recommendation?: 'study' | 'practice' | 'mastered' | null;
  feedback?: string | null;
  kp_results?: BackendScopeDiagnosticAttemptKpResult[];
  linked_plan_id?: string | null;
  linked_plan_status?: string | null;
  linked_report_available: boolean;
};

type BackendImprovementRetestTaskResult = {
  task_id: string;
  kp_id: string;
  kp_name: string;
  correct_count: number;
  total_count: number;
  mastery_before?: number | null;
  mastery_after?: number | null;
  passed: boolean;
  next_status: 'passed' | 'needs_retest';
  feedback: string;
};

type BackendImprovementRetestSessionResponse = {
  attempt_id: string;
  plan: BackendImprovementPlanResponse;
  session: PracticeSession;
};

type BackendImprovementRetestResultResponse = {
  attempt_id: string;
  plan: BackendImprovementPlanResponse;
  correct_count: number;
  total_count: number;
  passed_count: number;
  needs_retest_count: number;
  task_results: BackendImprovementRetestTaskResult[];
};

type BackendImprovementReportTaskItem = {
  task_id: string;
  kp_id: string;
  kp_name: string;
  group_id?: string | null;
  group_name?: string | null;
  priority: number;
  status: ImprovementTaskStatus;
  recommended_action: ImprovementRecommendedAction;
  reason: string;
  diagnostic_correct_count: number;
  diagnostic_total_count: number;
  mastery_before: number;
  mastery_after_diagnostic: number;
  latest_retest_correct_count?: number | null;
  latest_retest_total_count?: number | null;
  latest_retest_mastery_before?: number | null;
  latest_retest_mastery_after?: number | null;
  latest_retest_passed?: boolean | null;
  final_label: string;
};

type BackendImprovementReportRetestAttempt = {
  attempt_id: string;
  status: string;
  correct_count: number;
  total_count: number;
  passed_count: number;
  needs_retest_count: number;
  created_at?: string | null;
  submitted_at?: string | null;
};

type BackendImprovementReportSummary = {
  plan_id: string;
  scope_type: 'chapter' | 'section';
  scope_id: string;
  scope_name: string;
  plan_status: ImprovementPlan['status'];
  created_at?: string | null;
  completed_at?: string | null;
  diagnostic_correct_count: number;
  diagnostic_total_count: number;
  diagnostic_accuracy: number;
  task_count: number;
  weak_task_count: number;
  passed_task_count: number;
  needs_retest_task_count: number;
  practiced_task_count: number;
  pending_task_count: number;
  retest_attempt_count: number;
  latest_retest_accuracy?: number | null;
  completed: boolean;
};

type BackendImprovementReportResponse = {
  summary: BackendImprovementReportSummary;
  diagnostic_result?: ScopeDiagnosticResult | null;
  tasks: BackendImprovementReportTaskItem[];
  retest_attempts: BackendImprovementReportRetestAttempt[];
  strengths: string[];
  remaining_weaknesses: string[];
  next_actions: string[];
};

type BackendImprovementReportListItem = {
  plan_id: string;
  scope_type: 'chapter' | 'section';
  scope_id: string;
  scope_name: string;
  created_at?: string | null;
  completed_at?: string | null;
  diagnostic_correct_count: number;
  diagnostic_total_count: number;
  diagnostic_accuracy: number;
  task_count: number;
  passed_task_count: number;
  needs_retest_task_count: number;
  latest_retest_accuracy?: number | null;
  summary_label: string;
  highlight: string;
};

type BackendImprovementReportListResponse = {
  items?: BackendImprovementReportListItem[];
  total: number;
  limit: number;
  offset: number;
};

type BackendLearningTraceEvent = {
  id: string;
  event_type: string;
  event_time: string;
  student_id: string;
  scope_type?: string | null;
  scope_id?: string | null;
  scope_name?: string | null;
  title: string;
  description: string;
  attempt_id?: string | null;
  plan_id?: string | null;
  task_id?: string | null;
  retest_attempt_id?: string | null;
  kp_id?: string | null;
  kp_name?: string | null;
  status_label?: string | null;
  primary_action?: string | null;
  report_available: boolean;
  metadata?: Record<string, unknown> | null;
};

type BackendLearningTraceResponse = {
  items?: BackendLearningTraceEvent[];
  total: number;
  limit: number;
  offset: number;
};

type BackendKnowledgeMasteryEvidence = {
  source: string;
  label: string;
  occurred_at?: string | null;
  strength?: string | null;
  description: string;
  ref_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

type BackendKnowledgeMasteryJudgment = {
  kp_id: string;
  kp_name: string;
  mastery_score: number;
  mastery_level: string;
  intervention_status: string;
  confidence: string;
  next_action: string;
  reason: string;
  evidence_sources: string[];
  evidences: BackendKnowledgeMasteryEvidence[];
  last_answered_at?: string | null;
  last_diagnostic_at?: string | null;
  last_retest_at?: string | null;
  recent_correct_count: number;
  recent_total_count: number;
  recent_correct_rate?: number | null;
  latest_diagnostic_attempt_id?: string | null;
  latest_diagnostic_correct_count?: number | null;
  latest_diagnostic_total_count?: number | null;
  latest_diagnostic_is_weak?: boolean | null;
  active_plan_id?: string | null;
  active_task_id?: string | null;
  active_task_status?: string | null;
  latest_retest_attempt_id?: string | null;
  latest_retest_passed?: boolean | null;
  updated_at?: string | null;
};

type BackendKnowledgeMasteryJudgmentBatchResponse = {
  items?: BackendKnowledgeMasteryJudgment[];
};

type BackendScopeKnowledgeMasteryJudgmentResponse = {
  scope_type: 'chapter' | 'section' | string;
  scope_id: string;
  scope_name: string;
  items?: BackendKnowledgeMasteryJudgment[];
};

function mapImprovementPlan(data: BackendImprovementPlanResponse): ImprovementPlan {
  return {
    id: data.id,
    diagnosticAttemptId: data.diagnostic_attempt_id ?? null,
    scopeType: data.scope_type,
    scopeId: data.scope_id,
    scopeName: data.scope_name,
    createdAt: data.created_at,
    updatedAt: data.updated_at ?? null,
    completedAt: data.completed_at ?? null,
    correctCount: data.correct_count,
    totalCount: data.total_count,
    weakCount: data.weak_count,
    status: data.status,
    currentTaskId: data.current_task_id ?? null,
    sourceResult: data.source_result ?? null,
    tasks: data.tasks.map(task => ({
      id: task.id,
      kpId: task.kp_id,
      kpName: task.kp_name,
      groupId: task.group_id ?? null,
      groupName: task.group_name ?? null,
      correctCount: task.correct_count,
      totalCount: task.total_count,
      masteryBefore: task.mastery_before,
      masteryAfter: task.mastery_after,
      isWeak: task.is_weak,
      priority: task.priority,
      status: task.status,
      recommendedAction: task.recommended_action,
      reason: task.reason,
      startedAt: task.started_at ?? null,
      practicedAt: task.practiced_at ?? null,
      passedAt: task.passed_at ?? null,
      createdAt: task.created_at ?? null,
      updatedAt: task.updated_at ?? null,
    })),
  };
}

function mapScopeDiagnosticAttemptListItem(data: BackendScopeDiagnosticAttemptListItem) {
  return {
    attemptId: data.attempt_id,
    scopeType: data.scope_type,
    scopeId: data.scope_id,
    scopeName: data.scope_name,
    diagnosticType: data.diagnostic_type,
    createdAt: data.created_at,
    submittedAt: data.submitted_at,
    correctCount: data.correct_count,
    totalCount: data.total_count,
    weakCount: data.weak_count,
    recommendation: data.recommendation ?? null,
    feedback: data.feedback ?? null,
    linkedPlanId: data.linked_plan_id ?? null,
    linkedPlanStatus: data.linked_plan_status ?? null,
    linkedReportAvailable: data.linked_report_available,
  };
}

function mapScopeDiagnosticAttemptDetail(data: BackendScopeDiagnosticAttemptDetail): ScopeDiagnosticAttemptDetail {
  return {
    attemptId: data.attempt_id,
    studentId: data.student_id,
    scopeType: data.scope_type,
    scopeId: data.scope_id,
    scopeName: data.scope_name,
    diagnosticType: data.diagnostic_type,
    status: data.status,
    createdAt: data.created_at,
    submittedAt: data.submitted_at,
    questionIds: data.question_ids,
    answerIds: data.answer_ids,
    result: data.result ?? null,
    correctCount: data.correct_count,
    totalCount: data.total_count,
    weakCount: data.weak_count,
    weakKpIds: data.weak_kp_ids,
    recommendation: data.recommendation ?? null,
    feedback: data.feedback ?? null,
    kpResults: (data.kp_results || []).map(item => ({
      id: item.id,
      kpId: item.kp_id,
      kpName: item.kp_name,
      groupId: item.group_id ?? null,
      groupName: item.group_name ?? null,
      correctCount: item.correct_count,
      totalCount: item.total_count,
      masteryBefore: item.mastery_before,
      masteryAfter: item.mastery_after,
      isWeak: item.is_weak,
    })),
    linkedPlanId: data.linked_plan_id ?? null,
    linkedPlanStatus: data.linked_plan_status ?? null,
    linkedReportAvailable: data.linked_report_available,
  };
}

function mapImprovementRetestTaskResult(data: BackendImprovementRetestTaskResult) {
  return {
    taskId: data.task_id,
    kpId: data.kp_id,
    kpName: data.kp_name,
    correctCount: data.correct_count,
    totalCount: data.total_count,
    masteryBefore: data.mastery_before ?? null,
    masteryAfter: data.mastery_after ?? null,
    passed: data.passed,
    nextStatus: data.next_status,
    feedback: data.feedback,
  };
}

function mapImprovementRetestSession(data: BackendImprovementRetestSessionResponse): ImprovementRetestSession {
  return {
    attemptId: data.attempt_id,
    plan: mapImprovementPlan(data.plan),
    session: data.session,
  };
}

function mapImprovementRetestResult(data: BackendImprovementRetestResultResponse): ImprovementRetestResult {
  return {
    attemptId: data.attempt_id,
    plan: mapImprovementPlan(data.plan),
    correctCount: data.correct_count,
    totalCount: data.total_count,
    passedCount: data.passed_count,
    needsRetestCount: data.needs_retest_count,
    taskResults: data.task_results.map(mapImprovementRetestTaskResult),
  };
}

function mapImprovementReport(data: BackendImprovementReportResponse): ImprovementReport {
  return {
    summary: {
      planId: data.summary.plan_id,
      scopeType: data.summary.scope_type,
      scopeId: data.summary.scope_id,
      scopeName: data.summary.scope_name,
      planStatus: data.summary.plan_status,
      createdAt: data.summary.created_at ?? null,
      completedAt: data.summary.completed_at ?? null,
      diagnosticCorrectCount: data.summary.diagnostic_correct_count,
      diagnosticTotalCount: data.summary.diagnostic_total_count,
      diagnosticAccuracy: data.summary.diagnostic_accuracy,
      taskCount: data.summary.task_count,
      weakTaskCount: data.summary.weak_task_count,
      passedTaskCount: data.summary.passed_task_count,
      needsRetestTaskCount: data.summary.needs_retest_task_count,
      practicedTaskCount: data.summary.practiced_task_count,
      pendingTaskCount: data.summary.pending_task_count,
      retestAttemptCount: data.summary.retest_attempt_count,
      latestRetestAccuracy: data.summary.latest_retest_accuracy ?? null,
      completed: data.summary.completed,
    },
    diagnosticResult: data.diagnostic_result ?? null,
    tasks: data.tasks.map(task => ({
      taskId: task.task_id,
      kpId: task.kp_id,
      kpName: task.kp_name,
      groupId: task.group_id ?? null,
      groupName: task.group_name ?? null,
      priority: task.priority,
      status: task.status,
      recommendedAction: task.recommended_action,
      reason: task.reason,
      diagnosticCorrectCount: task.diagnostic_correct_count,
      diagnosticTotalCount: task.diagnostic_total_count,
      masteryBefore: task.mastery_before,
      masteryAfterDiagnostic: task.mastery_after_diagnostic,
      latestRetestCorrectCount: task.latest_retest_correct_count ?? null,
      latestRetestTotalCount: task.latest_retest_total_count ?? null,
      latestRetestMasteryBefore: task.latest_retest_mastery_before ?? null,
      latestRetestMasteryAfter: task.latest_retest_mastery_after ?? null,
      latestRetestPassed: task.latest_retest_passed ?? null,
      finalLabel: task.final_label,
    })),
    retestAttempts: data.retest_attempts.map(attempt => ({
      attemptId: attempt.attempt_id,
      status: attempt.status,
      correctCount: attempt.correct_count,
      totalCount: attempt.total_count,
      passedCount: attempt.passed_count,
      needsRetestCount: attempt.needs_retest_count,
      createdAt: attempt.created_at ?? null,
      submittedAt: attempt.submitted_at ?? null,
    })),
    strengths: data.strengths,
    remainingWeaknesses: data.remaining_weaknesses,
    nextActions: data.next_actions,
  };
}

function mapImprovementReportList(data: BackendImprovementReportListResponse): ImprovementReportListResponse {
  return {
    items: (data.items || []).map(item => ({
      planId: item.plan_id,
      scopeType: item.scope_type,
      scopeId: item.scope_id,
      scopeName: item.scope_name,
      createdAt: item.created_at ?? null,
      completedAt: item.completed_at ?? null,
      diagnosticCorrectCount: item.diagnostic_correct_count,
      diagnosticTotalCount: item.diagnostic_total_count,
      diagnosticAccuracy: item.diagnostic_accuracy,
      taskCount: item.task_count,
      passedTaskCount: item.passed_task_count,
      needsRetestTaskCount: item.needs_retest_task_count,
      latestRetestAccuracy: item.latest_retest_accuracy ?? null,
      summaryLabel: item.summary_label,
      highlight: item.highlight,
    })),
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

function mapLearningTraceEvent(data: BackendLearningTraceEvent): LearningTraceEvent {
  return {
    id: data.id,
    eventType: data.event_type,
    eventTime: data.event_time,
    studentId: data.student_id,
    scopeType: data.scope_type ?? null,
    scopeId: data.scope_id ?? null,
    scopeName: data.scope_name ?? null,
    title: data.title,
    description: data.description,
    attemptId: data.attempt_id ?? null,
    planId: data.plan_id ?? null,
    taskId: data.task_id ?? null,
    retestAttemptId: data.retest_attempt_id ?? null,
    kpId: data.kp_id ?? null,
    kpName: data.kp_name ?? null,
    statusLabel: data.status_label ?? null,
    primaryAction: data.primary_action ?? null,
    reportAvailable: data.report_available,
    metadata: data.metadata ?? {},
  };
}

function mapLearningTrace(data: BackendLearningTraceResponse): LearningTraceResponse {
  return {
    items: (data.items || []).map(mapLearningTraceEvent),
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

function mapKnowledgeMasteryEvidence(data: BackendKnowledgeMasteryEvidence): KnowledgeMasteryEvidence {
  return {
    source: data.source,
    label: data.label,
    occurredAt: data.occurred_at ?? null,
    strength: data.strength ?? null,
    description: data.description,
    refId: data.ref_id ?? null,
    metadata: data.metadata ?? {},
  };
}

function mapKnowledgeMasteryJudgment(data: BackendKnowledgeMasteryJudgment): KnowledgeMasteryJudgment {
  return {
    kpId: data.kp_id,
    kpName: data.kp_name,
    masteryScore: data.mastery_score,
    masteryLevel: data.mastery_level,
    interventionStatus: data.intervention_status,
    confidence: data.confidence,
    nextAction: data.next_action,
    reason: data.reason,
    evidenceSources: data.evidence_sources,
    evidences: data.evidences.map(mapKnowledgeMasteryEvidence),
    lastAnsweredAt: data.last_answered_at ?? null,
    lastDiagnosticAt: data.last_diagnostic_at ?? null,
    lastRetestAt: data.last_retest_at ?? null,
    recentCorrectCount: data.recent_correct_count,
    recentTotalCount: data.recent_total_count,
    recentCorrectRate: data.recent_correct_rate ?? null,
    latestDiagnosticAttemptId: data.latest_diagnostic_attempt_id ?? null,
    latestDiagnosticCorrectCount: data.latest_diagnostic_correct_count ?? null,
    latestDiagnosticTotalCount: data.latest_diagnostic_total_count ?? null,
    latestDiagnosticIsWeak: data.latest_diagnostic_is_weak ?? null,
    activePlanId: data.active_plan_id ?? null,
    activeTaskId: data.active_task_id ?? null,
    activeTaskStatus: data.active_task_status ?? null,
    latestRetestAttemptId: data.latest_retest_attempt_id ?? null,
    latestRetestPassed: data.latest_retest_passed ?? null,
    updatedAt: data.updated_at ?? null,
  };
}

export const api = {
  getMyClasses: () => get<StudentClass[]>('/classes'),
  previewClassInvitation: (code: string) => post<StudentClassPreview>('/class-invitations/preview', { code }),
  joinClass: (code: string, disclosure_version: string, student_name: string) => post<StudentClass & { added: boolean; student_name: string }>('/classes/join', { code, disclosure_version, student_name }),
  renameStudent: async (studentName: string) => {
    const res = await authenticatedFetch(apiUrl('/student-name'), {
      method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ student_name: studentName }),
    });
    if (!res.ok) throw new Error(await readError(res));
    clearStudentApiCache();
    return res.json() as Promise<{ student_name: string }>;
  },
  leaveClass: async (classId: string) => {
    const res = await authenticatedFetch(apiUrl(`/classes/${encodeURIComponent(classId)}`), { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) throw new Error(await readError(res));
    clearStudentApiCache();
  },
  // ── Auth ──


  getCurrentStudent: () => get<StudentProfile>('/auth/me'),
  getAccountCredentials: () => get<AccountCredentialsSettings>('/auth/account-credentials'),


  login: async (username: string, password: string, captcha?: { captcha_id: string; captcha_answer: string }) => {
    const res = await fetch(apiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, ...captcha }),
    });
    if (!res.ok) throw await authError(res);
    const data = await res.json() as StudentLoginResponse;
    clearStudentApiCache();
    setStudentSession(data.access_token, data.student);
    return data;
  },

  changePassword: async (username: string, currentPassword: string, newPassword: string, captcha?: { captcha_id: string; captcha_answer: string }) => {
    const res = await fetch(apiUrl('/auth/change-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        current_password: currentPassword,
        new_password: newPassword,
        ...captcha,
      }),
    });
    if (!res.ok) throw await authError(res);
    return res.json() as Promise<{ changed: boolean }>;
  },

  securityRequest: async <T,>(path: 'account-credentials', data: Record<string, string | boolean>) => {
    const res = await authenticatedFetch(apiUrl(`/auth/${path}`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) throw await authError(res);
    clearStudentApiCache();
    return res.json() as Promise<T>;
  },

  getCaptcha: async () => {
    const res = await fetch(apiUrl('/auth/captcha'), { cache: 'no-store' });
    if (!res.ok) throw new Error(await readError(res));
    return res.json() as Promise<StudentCaptchaResponse>;
  },

  exchangeWebLoginTicket: async (ticket: string) => {
    const res = await fetch(apiUrl('/auth/web-login-ticket/exchange'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const result = await res.json() as StudentLoginResponse;
    clearStudentApiCache();
    setStudentSession(result.access_token, result.student);
    return result;
  },

  // ── Dashboard ──
  getDashboard: (studentId = getStudentId()) =>
    cachedGet<DashboardData>('/dashboard', { student_id: studentId }, SHORT_TTL_MS),

  // ── Train ──
  getTrainStart: (studentId = getStudentId()) =>
    cachedGet<TrainStartData>('/train/start', { student_id: studentId }, SHORT_TTL_MS),

  getPracticeSession: (studentId = getStudentId(), targetKp?: string, count?: number) =>
    get<PracticeSession>('/practice/session', {
      student_id: studentId,
      ...(targetKp && { target_kp: targetKp }),
      ...(count && { count: String(count) }),
    }),

  submitAnswer: (
    studentId: string,
    data: {
      question_id: string;
      given_answer: string;
      time_spent_ms: number;
      submission_id?: string;
      teacher_paper_attempt_id?: string;
      topic_context?: TopicPracticeContext;
      target_knowledge_point_id?: string | null;
    },
  ) => runIdempotentSubmission(
    `answer:${studentId}:${JSON.stringify(data.topic_context || null)}:${data.teacher_paper_attempt_id || ''}:${data.question_id}:${data.target_knowledge_point_id || ''}:${data.given_answer}`,
    data.submission_id,
    submissionId => post<SubmitResult>(
      `/practice/submit?student_id=${encodeURIComponent(studentId)}`,
      { ...data, submission_id: submissionId },
    ),
  ),

  correctAnswer: (
    answerId: number,
    data: { corrected_answer: string; is_correct: boolean; correction_reason?: string; error_type?: string | null },
  ) =>
    post<SubmitResult>(`/practice/answers/${answerId}/correct`, data),

  submitPhoto: async (
    studentId: string,
    image: File,
    questionId: string,
    timeSpentMs: number = 0,
    targetKnowledgePointId?: string | null,
    attemptScope?: string,
    teacherPaperAttemptId?: string,
    topicContext?: TopicPracticeContext,
  ): Promise<SubmitResult> => {
    const ownerToken = getStudentToken();
    const key = `photo:${studentId}:${attemptScope || ''}:${questionId}:${targetKnowledgePointId || ''}:${await blobFingerprint(image)}`;
    if (getStudentToken() !== ownerToken) throw new Error('登录状态已改变，请重新进入当前页面');
    return runIdempotentSubmission(key, attemptScope ? attemptSubmissionId(key) : undefined, async submissionId => {
      const formData = new FormData();
      formData.append('image', image);
      formData.append('question_id', questionId);
      formData.append('student_id', studentId);
      formData.append('time_spent_ms', String(timeSpentMs));
      formData.append('submission_id', submissionId);
      if (teacherPaperAttemptId) formData.append('teacher_paper_attempt_id', teacherPaperAttemptId);
      if (topicContext) formData.append('topic_context', JSON.stringify(topicContext));
      if (targetKnowledgePointId) {
        formData.append('target_knowledge_point_id', targetKnowledgePointId);
      }
      const res = await authenticatedFetch(apiUrl('/practice/submit-photo'), {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error(await readError(res));
      const result = await res.json();
      if(attemptScope)saveAttemptResult(attemptScope,questionId,result);
      clearStudentApiCache();
      return result;
    });
  },

  submitPaperBatch: async (
    images: File[],
    questionIds: string[],
    timeSpentMs: number = 0,
    targetKnowledgePointIds?: Record<string, string>,
    attemptScope?: string,
    teacherPaperAttemptId?: string,
    topicContext?: TopicPracticeContext,
  ): Promise<PaperBatchGradeResponse> => {
    const ownerToken = getStudentToken();
    const fileKey = (await Promise.all(images.map(blobFingerprint))).join('|');
    if (getStudentToken() !== ownerToken) throw new Error('登录状态已改变，请重新进入当前页面');
    const targetKey = JSON.stringify(targetKnowledgePointIds || {});
    const key = `paper:${getStudentId()}:${attemptScope || ''}:${questionIds.join(',')}:${targetKey}:${fileKey}`;
    return runIdempotentSubmission(key, attemptScope ? attemptSubmissionId(`paper-attempt:${getStudentId()}:${attemptScope}:${questionIds.join(',')}`) : undefined, async submissionId => {
      const formData = new FormData();
      images.forEach(image => formData.append('images', image));
      formData.append('question_ids', JSON.stringify(questionIds));
      formData.append('time_spent_ms', String(timeSpentMs));
      formData.append('submission_id', submissionId);
      if (teacherPaperAttemptId) formData.append('teacher_paper_attempt_id', teacherPaperAttemptId);
      if (topicContext) formData.append('topic_context', JSON.stringify(topicContext));
      if (targetKnowledgePointIds && Object.keys(targetKnowledgePointIds).length > 0) {
        formData.append('target_knowledge_point_ids', JSON.stringify(targetKnowledgePointIds));
      }
      const res = await authenticatedFetch(apiUrl('/practice/submit-paper-batch'), {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error(await readError(res));
      const result = await res.json();
      if(attemptScope)Object.entries(result.results || {}).forEach(([id,answer])=>saveAttemptResult(attemptScope,id,answer as SubmitResult));
      clearStudentApiCache();
      return result;
    });
  },

  submitSelfReview: (data: {
    question_id: string;
    items: Array<{ label: string; status: 'correct' | 'partial' | 'wrong' }>;
    time_spent_ms?: number;
    submission_id?: string;
    teacher_paper_attempt_id?: string;
    topic_context?: TopicPracticeContext;
    target_knowledge_point_id?: string | null;
  }, attemptScope?: string) => runIdempotentSubmission(
    `self-review:${getStudentId()}:${attemptScope || ''}:${data.question_id}:${data.target_knowledge_point_id || ''}:${JSON.stringify(data.items)}`,
    data.submission_id || (attemptScope ? attemptSubmissionId(`self-review:${getStudentId()}:${attemptScope}:${data.question_id}:${data.target_knowledge_point_id || ''}:${JSON.stringify(data.items)}`) : undefined),
    submissionId => post<SubmitResult>(
      '/practice/self-review',
      { ...data, submission_id: submissionId },
    ).then(result=>{
      if(attemptScope)saveAttemptResult(attemptScope,data.question_id,result);
      return result;
    }),
  ),

  submitProcessEvidence: async (
    answerId: number,
    questionId: string,
    image: File,
    timeSpentMs: number = 0,
  ): Promise<{ answer_id: number; question_id: string; process_grading: SubmitResult['process_grading'] }> => {
    const formData = new FormData();
    formData.append('image', image);
    formData.append('question_id', questionId);
    formData.append('answer_id', String(answerId));
    formData.append('time_spent_ms', String(timeSpentMs));
    const res = await authenticatedFetch(apiUrl('/practice/process-evidence'), {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    clearStudentApiCache();
    return data;
  },

  // ── Review ──
  getReview: (studentId = getStudentId(), groupBy = 'kp') =>
    cachedGet<ReviewData>('/review', { student_id: studentId, group_by: groupBy }, SHORT_TTL_MS),

  retrySimilar: (answerId: number, studentId = getStudentId(), excludeQuestionIds: string[] = []) =>
    post<RetryData>(`/review/retry/${answerId}?${new URLSearchParams({
      student_id: studentId,
      ...(excludeQuestionIds.length && { exclude_question_ids: excludeQuestionIds.join(',') }),
    })}`),

  getVariations: (answerId: number, studentId = getStudentId(), excludeQuestionIds: string[] = []) =>
    get<VariationData>(`/review/variations/${answerId}`, {
      student_id: studentId,
      ...(excludeQuestionIds.length && { exclude_question_ids: excludeQuestionIds.join(',') }),
    }),

  completeReview: (answerId: number): Promise<{ cleared: boolean }> =>
    post<{ cleared: boolean }>(`/review/${answerId}/complete`),

  getAnswerHistory: (params: {
    limit?: number;
    offset?: number;
    from_date?: string;
    to_date?: string;
  } = {}) =>
    cachedGet<AnswerHistoryItem[]>('/history/answers', {
      limit: String(params.limit ?? 50),
      offset: String(params.offset ?? 0),
      ...(params.from_date && { from_date: params.from_date }),
      ...(params.to_date && { to_date: params.to_date }),
    }, SHORT_TTL_MS),

  // ── Learn ──
  getLearnBundle: (kpId: string, studentId = getStudentId()) =>
    cachedGet<LearnBundle>(`/learn/${kpId}`, { student_id: studentId }, DIRECTORY_TTL_MS),

  getLearnVideos: (kpId: string, studentId = getStudentId()) =>
    cachedGet<VideoRecommendationResponse>(`/learn/${kpId}/videos`, { student_id: studentId }, DIRECTORY_TTL_MS),

  getLearnSimulation: (kpId: string, studentId = getStudentId()) =>
    cachedGet<PhysicsSimulationResponse>(`/learn/${kpId}/simulation`, { student_id: studentId }, DIRECTORY_TTL_MS),

  markLearnComplete: (
    kpId: string,
    data: { kp_id: string; content_id: string; content_type: string; time_spent_seconds: number },
    studentId = getStudentId(),
  ) =>
    post<LearnCompleteResult>(`/learn/${kpId}/complete?student_id=${encodeURIComponent(studentId)}`, data),

  // ── Directory ──
  getDirectory: (studentId = getStudentId(), includePending = true) =>
    cachedGet<DirectoryData>('/directory', { student_id: studentId, include_pending: String(includePending) }, DIRECTORY_TTL_MS),

  getLearningCatalog: (catalogCode: string) =>
    cachedGet<LearningCatalogData>(
      `/learning-catalogs/${encodeURIComponent(catalogCode)}`,
      undefined,
      DIRECTORY_TTL_MS,
    ),

  getLearningCatalogResume: (catalogCode: string) =>
    get<LearningCatalogResume>(
      `/learning-catalogs/${encodeURIComponent(catalogCode)}/resume`,
    ),

  getLearningCatalogTopicOverview: (
    catalogCode: string,
    nodeId: string,
  ) =>
    get<LearningCatalogTopicOverview>(
      `/learning-catalogs/${encodeURIComponent(catalogCode)}/nodes/${encodeURIComponent(nodeId)}/overview`,
    ),

  startLearningCatalogTopicSession: (
    catalogCode: string,
    nodeId: string,
    layer: LearningCatalogTopicLayer,
    questionCount: number,
  ) =>
    post<PracticeSession>(
      `/learning-catalogs/${encodeURIComponent(catalogCode)}/nodes/${encodeURIComponent(nodeId)}/session`,
      { layer, question_count: questionCount },
    ),

  recordLearningCatalogTopicEvidence: (
    catalogCode: string,
    nodeId: string,
    layer: LearningCatalogTopicLayer,
    answerId: number,
  ) =>
    post<LearningCatalogTopicOverview>(
      `/learning-catalogs/${encodeURIComponent(catalogCode)}/nodes/${encodeURIComponent(nodeId)}/evidence`,
      { layer, answer_id: answerId },
    ),

  listTeacherHomework: (options?: { history?: boolean }) =>
    get<TeacherHomework[]>('/teacher-homework', options?.history ? { history: 'true' } : undefined),
  openTeacherHomework: (attemptId: string) =>
    post<PracticeSession>(`/teacher-homework/${encodeURIComponent(attemptId)}/session`, {}),
  submitTeacherPaperAttempt: (attemptId: string) =>
    post(`/teacher-paper-attempts/${encodeURIComponent(attemptId)}/submit`, {}),

  getQuestionLessonVideo: (questionId: string, answerId: number) =>
    post<import('../types').TeacherPaperQuestionVideo>(`/questions/${encodeURIComponent(questionId)}/lesson-video`,
      { answer_id: answerId }),

  prefetchDirectory: (studentId = getStudentId()) => {
    void cachedGet<DirectoryData>('/directory', { student_id: studentId }, DIRECTORY_TTL_MS).catch(() => undefined);
  },

  diagnoseKp: (kpId: string, questionCount = 3, studentId = getStudentId()) =>
    post<PracticeSession>(
      `/diagnose/kp/${kpId}?student_id=${encodeURIComponent(studentId)}`,
      { question_count: questionCount },
    ),

  getKpSubmittedDiagnosticFeedback: (
    kpId: string,
    answers: { answer_id: number; mastery_update: Record<string, { before: number; after: number; name: string }> }[],
    studentId = getStudentId(),
  ) =>
    post<KpDiagnosticResult>(
      `/diagnose/kp/${kpId}/submitted-feedback?student_id=${encodeURIComponent(studentId)}`,
      { answers },
    ),

  // ── Tutor ──
  questionTutorChat: (data: {
    question_id: string;
    given_answer: string;
    message: string;
    history: ChatMessage[];
    process_grading?: unknown;
  }) =>
    post<{ text: string }>('/tutor/question-chat', data),

  // ── Scope Diagnostic ──
  scopeDiagnose: (scopeType: string, scopeId: string, questionCount = 6, studentId = getStudentId()) =>
    post<PracticeSession>(`/diagnose/scope?student_id=${encodeURIComponent(studentId)}`, {
      scope_type: scopeType,
      scope_id: scopeId,
      question_count: questionCount,
    }),

  getSubmittedScopeDiagnosticFeedback: (
    scopeType: string,
    scopeId: string,
    answers: { answer_id: number; mastery_update: Record<string, { before: number; after: number; name: string }> }[],
    studentId = getStudentId(),
  ) =>
    post<ScopeDiagnosticResult>(`/diagnose/scope/submitted-feedback?student_id=${encodeURIComponent(studentId)}`, {
      scope_type: scopeType,
      scope_id: scopeId,
      answers,
    }),

  listScopeDiagnosticAttempts: async (
    studentId = getStudentId(),
    params: { limit?: number; offset?: number; scopeType?: 'chapter' | 'section'; scopeId?: string } = {},
  ): Promise<ScopeDiagnosticAttemptListResponse> => {
    const data = await get<BackendScopeDiagnosticAttemptListResponse>('/diagnostics/scope/attempts', {
      student_id: studentId,
      ...(params.limit !== undefined && { limit: String(params.limit) }),
      ...(params.offset !== undefined && { offset: String(params.offset) }),
      ...(params.scopeType && { scope_type: params.scopeType }),
      ...(params.scopeId && { scope_id: params.scopeId }),
    });
    return {
      items: (data.items || []).map(mapScopeDiagnosticAttemptListItem),
      total: data.total,
      limit: data.limit,
      offset: data.offset,
    };
  },

  getScopeDiagnosticAttempt: async (
    attemptId: string,
    studentId = getStudentId(),
  ): Promise<ScopeDiagnosticAttemptDetail> => {
    const data = await get<BackendScopeDiagnosticAttemptDetail>(
      `/diagnostics/scope/attempts/${attemptId}`,
      { student_id: studentId },
    );
    return mapScopeDiagnosticAttemptDetail(data);
  },

  // ── Improvement Plan ──
  createImprovementPlanFromScopeResult: async (
    diagnosticResult: ScopeDiagnosticResult,
    studentId = getStudentId(),
  ) => {
    const data = await post<BackendImprovementPlanResponse>(
      `/improvement/plans/from-scope-result?student_id=${encodeURIComponent(studentId)}`,
      { diagnostic_result: diagnosticResult },
    );
    return mapImprovementPlan(data);
  },

  getLatestImprovementPlan: async (
    studentId = getStudentId(),
    params: { scopeType?: 'chapter' | 'section'; scopeId?: string } = {},
  ) => {
    const data = await getOptional<BackendImprovementPlanResponse>('/improvement/plans/latest', {
      student_id: studentId,
      ...(params.scopeType && { scope_type: params.scopeType }),
      ...(params.scopeId && { scope_id: params.scopeId }),
    });
    return data ? mapImprovementPlan(data) : null;
  },

  getImprovementPlan: async (planId: string, studentId = getStudentId()) => {
    const data = await get<BackendImprovementPlanResponse>(`/improvement/plans/${planId}`, {
      student_id: studentId,
    });
    return mapImprovementPlan(data);
  },

  updateImprovementTaskStatus: async (
    planId: string,
    taskId: string,
    status: ImprovementTaskStatus,
    studentId = getStudentId(),
  ) => {
    const data = await patch<BackendImprovementPlanResponse>(
      `/improvement/plans/${planId}/tasks/${taskId}?student_id=${encodeURIComponent(studentId)}`,
      { status },
    );
    return mapImprovementPlan(data);
  },

  moveToNextImprovementTaskOnServer: async (planId: string, studentId = getStudentId()) => {
    const data = await post<BackendImprovementPlanResponse>(
      `/improvement/plans/${planId}/next?student_id=${encodeURIComponent(studentId)}`,
      { mark_in_progress: true },
    );
    return mapImprovementPlan(data);
  },

  startImprovementRetest: async (
    planId: string,
    data?: { questionCountPerTask?: number; maxQuestions?: number },
    studentId = getStudentId(),
  ) => {
    const response = await post<BackendImprovementRetestSessionResponse>(
      `/improvement/plans/${planId}/retest/start?student_id=${encodeURIComponent(studentId)}`,
      data ? {
        question_count_per_task: data.questionCountPerTask,
        max_questions: data.maxQuestions,
      } : undefined,
    );
    return mapImprovementRetestSession(response);
  },

  submitImprovementRetestFeedback: async (
    planId: string,
    attemptId: string,
    answers: SubmittedDiagnosticAnswer[],
    studentId = getStudentId(),
  ) => {
    const data = await post<BackendImprovementRetestResultResponse>(
      `/improvement/plans/${planId}/retest/${attemptId}/submitted-feedback?student_id=${encodeURIComponent(studentId)}`,
      { answers },
    );
    return mapImprovementRetestResult(data);
  },
  getImprovementReport: async (planId: string, studentId = getStudentId()) => {
    const data = await get<BackendImprovementReportResponse>(`/improvement/plans/${planId}/report`, {
      student_id: studentId,
    });
    return mapImprovementReport(data);
  },
  getLatestCompletedImprovementReport: async (
    studentId = getStudentId(),
    params: { scopeType?: 'chapter' | 'section'; scopeId?: string } = {},
  ) => {
    const data = await getOptional<BackendImprovementReportResponse>('/improvement/reports/latest-completed', {
      student_id: studentId,
      ...(params.scopeType && { scope_type: params.scopeType }),
      ...(params.scopeId && { scope_id: params.scopeId }),
    });
    return data ? mapImprovementReport(data) : null;
  },
  listImprovementReports: async (
    studentId = getStudentId(),
    params: {
      limit?: number;
      offset?: number;
      scopeType?: 'chapter' | 'section';
      scopeId?: string;
    } = {},
  ) => {
    const data = await get<BackendImprovementReportListResponse>('/improvement/reports', {
      student_id: studentId,
      limit: String(params.limit ?? 10),
      offset: String(params.offset ?? 0),
      ...(params.scopeType && { scope_type: params.scopeType }),
      ...(params.scopeId && { scope_id: params.scopeId }),
    });
    return mapImprovementReportList(data);
  },

  // ── Learning Trace ──
  listLearningTrace: async (
    studentId = getStudentId(),
    params: {
      limit?: number;
      offset?: number;
      scopeType?: 'chapter' | 'section';
      scopeId?: string;
    } = {},
  ) => {
    const data = await get<BackendLearningTraceResponse>('/learning-trace', {
      student_id: studentId,
      limit: String(params.limit ?? 20),
      offset: String(params.offset ?? 0),
      ...(params.scopeType && { scope_type: params.scopeType }),
      ...(params.scopeId && { scope_id: params.scopeId }),
    });
    return mapLearningTrace(data);
  },

  // ── Knowledge Mastery Judgment ──
  getKnowledgeMasteryJudgments: async (kpIds: string[], studentId = getStudentId()): Promise<KnowledgeMasteryJudgmentBatchResponse> => {
    const data = await post<BackendKnowledgeMasteryJudgmentBatchResponse>(
      `/mastery-judgments/kps?student_id=${encodeURIComponent(studentId)}`,
      { kp_ids: kpIds },
    );
    return {
      items: (data.items || []).map(mapKnowledgeMasteryJudgment),
    };
  },

  getScopeKnowledgeMasteryJudgments: async (
    scopeType: 'chapter' | 'section',
    scopeId: string,
    studentId = getStudentId(),
  ): Promise<ScopeKnowledgeMasteryJudgmentResponse> => {
    const data = await get<BackendScopeKnowledgeMasteryJudgmentResponse>('/mastery-judgments/scope', {
      student_id: studentId,
      scope_type: scopeType,
      scope_id: scopeId,
    });
    return {
      scopeType: data.scope_type,
      scopeId: data.scope_id,
      scopeName: data.scope_name,
      items: (data.items || []).map(mapKnowledgeMasteryJudgment),
    };
  },

  // ── Growth Feedback ──────────────────────────────────────────────────────────

  /** Get today's backend-computed practice/review loop */
  getDailyLearningLoop: (studentId = getStudentId()) =>
    cachedGet<DailyLearningLoop>('/reward/daily-loop', { student_id: studentId }, SHORT_TTL_MS),

  /** Get recent backend-computed practice/review loop history */
  getDailyLearningLoopHistory: (studentId = getStudentId(), days = 35) =>
    cachedGet<DailyLearningLoopHistory>('/reward/daily-loop/history', {
      student_id: studentId,
      days: String(days),
    }, SHORT_TTL_MS),

  /** Get latest growth report */
  getGrowthReport: (studentId = getStudentId()) =>
    cachedGet<GrowthReportResponse>('/reward/growth-report', { student_id: studentId }, DIRECTORY_TTL_MS),

  /** Generate a new weekly growth report */
  generateGrowthReport: (studentId = getStudentId()) =>
    post<GrowthReportResponse>(`/reward/growth-report?student_id=${encodeURIComponent(studentId)}`),
};
