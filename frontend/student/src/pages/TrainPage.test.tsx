import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TrainPage from './TrainPage';
import { api } from '../api/client';
import type {
  DirectoryData,
  ImprovementPlan,
  ImprovementRetestResult,
  KnowledgeMasteryJudgment,
  LearningTraceEvent,
  PracticeSession,
  ScopeDiagnosticAttemptDetail,
  ScopeDiagnosticAttemptListItem,
  ScopeDiagnosticResult,
  StudentProfile,
  TrainStartData,
} from '../types';

vi.mock('../api/client', () => ({
  api: {
    getTrainStart: vi.fn(),
    getDirectory: vi.fn(),
    getPracticeSession: vi.fn(),
    scopeDiagnose: vi.fn(),
    getSubmittedScopeDiagnosticFeedback: vi.fn(),
    createImprovementPlanFromScopeResult: vi.fn(),
    getLatestImprovementPlan: vi.fn(),
    getImprovementPlan: vi.fn(),
    updateImprovementTaskStatus: vi.fn(),
    moveToNextImprovementTaskOnServer: vi.fn(),
    startImprovementRetest: vi.fn(),
    submitImprovementRetestFeedback: vi.fn(),
    getImprovementReport: vi.fn(),
    getLatestCompletedImprovementReport: vi.fn(),
    listImprovementReports: vi.fn(),
    listScopeDiagnosticAttempts: vi.fn(),
    getScopeDiagnosticAttempt: vi.fn(),
    listLearningTrace: vi.fn(),
    getKnowledgeMasteryJudgments: vi.fn(),
    getScopeKnowledgeMasteryJudgments: vi.fn(),
  },
}));

const studentIdentityMock = vi.hoisted(() => ({
  profile: {
    id: 'student-1',
    username: 'student',
    display_name: '学生',
    status: 'active',
    account_source: 'self_registered',


  } as StudentProfile,
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'student-1',
  // Match production: reading localStorage parses a fresh object every time.
  getStudentProfile: () => JSON.parse(JSON.stringify(studentIdentityMock.profile)),
}));

const scopeDiagnosticAnswer = {
  answer_id: 11,
  is_correct: true,
  correct_answer: 'A',
  explanation: null,
  mastery_update: {
    'kp-1': { before: 0.1, after: 0.76, name: '质点' },
  },
};

vi.mock('../components/QuestionSessionRunner', () => ({
  default: (props: any) => {
    const allGraded = props.questions.every((question: { id: string }) => !!props.resultForQuestion(question.id));
    useEffect(() => {
      if (allGraded) props.onAllGraded?.();
    }, [allGraded, props.onAllGraded]);
    return (
      <div>
        <div data-testid="runner-title" data-deferred={props.deferredGrading} data-collect={props.collectMode}>{props.title}</div>
        {props.onAnswered && (
          <button type="button" onClick={() => props.onAnswered('q-1', scopeDiagnosticAnswer)}>
            mock grade scope q-1
          </button>
        )}
        <div data-testid="runner-last-action">{props.lastAction}</div>
        <button type="button" onClick={props.onBack}>runner back</button>
      </div>
    );
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function cssRules(selector: string): string[] {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = Array.from(css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g')));
  return matches.map(match => match[1]);
}

function cssRule(selector: string): string {
  return cssRules(selector).at(-1) || '';
}

const trainStart: TrainStartData = {
  is_first_time: true,
  has_diagnosed: false,
  recommended_kps: [],
};

const directory: DirectoryData = {
  kps: [
    {
      id: 'kp-1',
      name: '质点',
      volume: '必修 第一册',
      chapter: '运动的描述',
      section: '质点 参考系',
      mastery: 0,
      status: 'needs_learning',
      blocked_by: [],
      last_practiced: null,
    },
  ],
  stats: {
    mastered: 0,
    in_progress: 1,
    locked: 0,
    total: 1,
  },
  relations: [],
};

const directoryWithRecentElectiveChapter: DirectoryData = {
  kps: [
    {
      id: 'kp-1',
      name: '质点',
      volume: '必修 第一册',
      chapter: '运动的描述',
      section: '质点 参考系',
      mastery: 0,
      status: 'needs_learning',
      blocked_by: [],
      last_practiced: null,
    },
    {
      id: 'kp-2',
      name: '楞次定律',
      volume: '选择性必修 第二册',
      chapter: '电磁感应',
      section: '楞次定律',
      mastery: 0.35,
      status: 'needs_learning',
      blocked_by: [],
      last_practiced: '2026-05-18T10:00:00Z',
    },
  ],
  stats: {
    mastered: 0,
    in_progress: 2,
    locked: 0,
    total: 2,
  },
  relations: [],
};

const practiceSession: PracticeSession = {
  student_id: 'student-1',
  session_type: 'practice',
  strategy: 'reinforcement',
  session_objective: '专项巩固',
  session_structure: {
    phases: [{ phase: 'practice', question_indices: [0] }],
    total: 1,
  },
  questions: [
    {
      id: 'q-1',
      stem_text: '题干',
      question_type: 'single_choice',
      options: [{ label: 'A', text: '选项' }],
    },
  ],
};

const retestSession: PracticeSession = {
  ...practiceSession,
  session_type: 'improvement_retest',
  strategy: 'improvement_retest',
  session_objective: '阶段复测「运动的描述」',
};

const weakScopeResult = {
  scope_type: 'chapter' as const,
  scope_id: '运动的描述',
  scope_name: '运动的描述',
  kp_results: [
    {
      kp_id: 'kp-1',
      kp_name: '质点',
      correct_count: 1,
      total_count: 1,
      mastery_before: 0,
      mastery_after: 0.8,
    },
    {
      kp_id: 'kp-weak',
      kp_name: '坐标系',
      correct_count: 0,
      total_count: 1,
      mastery_before: 0,
      mastery_after: 0.22,
    },
  ],
  correct_count: 1,
  total_count: 2,
  weak_kp_ids: ['kp-weak'],
  recommendation: 'study' as const,
  feedback: '先回看坐标系，再做专项练。',
};

const planPriorityScopeResult = {
  ...weakScopeResult,
  kp_results: [
    {
      kp_id: 'kp-secondary',
      kp_name: '先出现在薄弱列表',
      correct_count: 0,
      total_count: 1,
      mastery_before: 0.1,
      mastery_after: 0.42,
    },
    {
      kp_id: 'kp-primary',
      kp_name: '低掌握',
      correct_count: 0,
      total_count: 1,
      mastery_before: 0.05,
      mastery_after: 0.18,
    },
  ],
  correct_count: 0,
  total_count: 2,
  weak_kp_ids: ['kp-secondary', 'kp-primary'],
};

const emptyScopeResult = {
  ...weakScopeResult,
  kp_results: [],
  correct_count: 0,
  total_count: 0,
  weak_kp_ids: [],
  recommendation: 'mastered' as const,
  feedback: '本轮没有可继续安排的知识点。',
};

function makeServerPlan(
  sourceResult: ScopeDiagnosticResult,
  overrides: Partial<ImprovementPlan> = {},
): ImprovementPlan {
  return {
    id: 'server-plan-1',
    scopeType: sourceResult.scope_type,
    scopeId: sourceResult.scope_id,
    scopeName: sourceResult.scope_name,
    createdAt: '2026-06-27T02:00:00Z',
    updatedAt: '2026-06-27T02:00:00Z',
    correctCount: sourceResult.correct_count,
    totalCount: sourceResult.total_count,
    weakCount: sourceResult.weak_kp_ids.length,
    status: 'diagnosed',
    currentTaskId: 'server-task-1',
    sourceResult,
    tasks: [
      {
        id: 'server-task-1',
        kpId: 'kp-server',
        kpName: '后端推荐任务',
        groupId: '第一章 运动的描述||1.2 时间 位移',
        groupName: '1.2 时间 位移',
        correctCount: 0,
        totalCount: 1,
        masteryBefore: 0.1,
        masteryAfter: 0.2,
        isWeak: true,
        priority: 1,
        status: 'pending',
        recommendedAction: 'review_then_practice',
        reason: '本次定位暴露基础不稳，建议先回看关键概念，再做一组专项练。',
      },
      {
        id: 'server-task-2',
        kpId: 'kp-server-next',
        kpName: '后端下一任务',
        groupId: null,
        groupName: null,
        correctCount: 1,
        totalCount: 1,
        masteryBefore: 0.3,
        masteryAfter: 0.5,
        isWeak: false,
        priority: 2,
        status: 'pending',
        recommendedAction: 'practice',
        reason: '掌握还不稳定，建议完成一组针对性训练。',
      },
    ],
    ...overrides,
  };
}

function withServerTaskStatus(
  plan: ImprovementPlan,
  taskId: string,
  status: ImprovementPlan['tasks'][number]['status'],
  currentTaskId = plan.currentTaskId,
): ImprovementPlan {
  return {
    ...plan,
    status: status === 'in_progress' ? 'in_progress' : plan.status,
    currentTaskId,
    tasks: plan.tasks.map(task => (
      task.id === taskId ? { ...task, status } : task
    )),
  };
}

function makeReadyForRetestPlan(sourceResult: ScopeDiagnosticResult = weakScopeResult): ImprovementPlan {
  const plan = makeServerPlan(sourceResult);
  return {
    ...plan,
    status: 'ready_for_retest',
    currentTaskId: null,
    tasks: plan.tasks.map(task => ({ ...task, status: 'practiced' })),
  };
}

function makeJudgment(overrides: Partial<KnowledgeMasteryJudgment>): KnowledgeMasteryJudgment {
  return {
    kpId: 'kp-server',
    kpName: '后端推荐任务',
    masteryScore: 0.2,
    masteryLevel: 'weak',
    interventionStatus: 'needs_practice',
    confidence: 'high',
    nextAction: 'diagnose',
    reason: '建议先完成检测，再进入针对练习。',
    evidenceSources: [],
    evidences: [],
    recentCorrectCount: 0,
    recentTotalCount: 0,
    ...overrides,
  };
}

function makeRetestResult(plan: ImprovementPlan, passed: boolean): ImprovementRetestResult {
  const task = plan.tasks[0];
  const resultPlan: ImprovementPlan = passed
    ? {
      ...plan,
      status: 'completed',
      currentTaskId: null,
      completedAt: '2026-06-27T03:00:00Z',
      tasks: plan.tasks.map(item => ({ ...item, status: 'passed' })),
    }
    : {
      ...plan,
      status: 'in_progress',
      currentTaskId: task.id,
      tasks: plan.tasks.map((item, index) => (
        index === 0 ? { ...item, status: 'needs_retest' } : item
      )),
    };
  return {
    attemptId: 'attempt-1',
    plan: resultPlan,
    correctCount: passed ? 1 : 0,
    totalCount: 1,
    passedCount: passed ? 1 : 0,
    needsRetestCount: passed ? 0 : 1,
    taskResults: [
      {
        taskId: task.id,
        kpId: task.kpId,
        kpName: task.kpName,
        correctCount: passed ? 1 : 0,
        totalCount: 1,
        masteryBefore: 0.2,
        masteryAfter: passed ? 0.82 : 0.35,
        passed,
        nextStatus: passed ? 'passed' as const : 'needs_retest' as const,
        feedback: passed ? '本步已通过。' : '建议继续补弱后再测。',
      },
    ],
  };
}

function makeImprovementReport(plan: ImprovementPlan) {
  const task = plan.tasks[0];
  return {
    summary: {
      planId: plan.id,
      scopeType: plan.scopeType,
      scopeId: plan.scopeId,
      scopeName: plan.scopeName,
      planStatus: plan.status,
      createdAt: plan.createdAt,
      completedAt: plan.completedAt ?? null,
      diagnosticCorrectCount: plan.correctCount,
      diagnosticTotalCount: plan.totalCount,
      diagnosticAccuracy: plan.totalCount ? plan.correctCount / plan.totalCount : 0,
      taskCount: plan.tasks.length,
      weakTaskCount: plan.weakCount,
      passedTaskCount: plan.tasks.filter(item => item.status === 'passed').length,
      needsRetestTaskCount: plan.tasks.filter(item => item.status === 'needs_retest').length,
      practicedTaskCount: plan.tasks.filter(item => item.status === 'practiced').length,
      pendingTaskCount: plan.tasks.filter(item => item.status === 'pending' || item.status === 'in_progress').length,
      retestAttemptCount: 1,
      latestRetestAccuracy: 1,
      completed: plan.status === 'completed',
    },
    diagnosticResult: plan.sourceResult ?? weakScopeResult,
    tasks: [{
      taskId: task.id,
      kpId: task.kpId,
      kpName: task.kpName,
      groupId: task.groupId ?? null,
      groupName: task.groupName ?? null,
      priority: task.priority,
      status: task.status,
      recommendedAction: task.recommendedAction,
      reason: '复测 1/1 正确，掌握度达到 82%，本步已通过。',
      diagnosticCorrectCount: task.correctCount,
      diagnosticTotalCount: task.totalCount,
      masteryBefore: task.masteryBefore,
      masteryAfterDiagnostic: task.masteryAfter,
      latestRetestCorrectCount: 1,
      latestRetestTotalCount: 1,
      latestRetestMasteryBefore: 0.2,
      latestRetestMasteryAfter: 0.82,
      latestRetestPassed: true,
      finalLabel: '已通过',
    }],
    retestAttempts: [{
      attemptId: 'attempt-1',
      status: 'submitted',
      correctCount: 1,
      totalCount: 1,
      passedCount: 1,
      needsRetestCount: 0,
      createdAt: '2026-06-27T02:00:00Z',
      submittedAt: '2026-06-27T02:05:00Z',
    }],
    strengths: ['本轮「运动的描述」提升闭环已完成。'],
    remainingWeaknesses: [],
    nextActions: ['可以回到巩固提升首页选择新的章节或单元继续检测。'],
  };
}

function makeReportListItem(plan: ImprovementPlan, overrides: Record<string, unknown> = {}) {
  const passedTaskCount = plan.tasks.filter(task => task.status === 'passed').length;
  return {
    planId: plan.id,
    scopeType: plan.scopeType,
    scopeId: plan.scopeId,
    scopeName: plan.scopeName,
    createdAt: plan.createdAt,
    completedAt: plan.completedAt ?? '2026-06-27T03:00:00Z',
    diagnosticCorrectCount: plan.correctCount,
    diagnosticTotalCount: plan.totalCount,
    diagnosticAccuracy: plan.totalCount ? plan.correctCount / plan.totalCount : 0,
    taskCount: plan.tasks.length,
    passedTaskCount,
    needsRetestTaskCount: plan.tasks.filter(task => task.status === 'needs_retest').length,
    latestRetestAccuracy: 1,
    summaryLabel: passedTaskCount === plan.tasks.length ? '已完成' : '部分完成',
    highlight: `已通过 ${passedTaskCount}/${plan.tasks.length} 个提升任务`,
    ...overrides,
  };
}

function makeDiagnosticHistoryItem(
  overrides: Partial<ScopeDiagnosticAttemptListItem> = {},
): ScopeDiagnosticAttemptListItem {
  return {
    attemptId: 'attempt-first',
    scopeType: 'chapter',
    scopeId: '第一章 运动的描述',
    scopeName: '第一单元',
    diagnosticType: 'scope',
    createdAt: '2026-06-25T02:00:00Z',
    submittedAt: '2026-06-25T02:05:00Z',
    correctCount: 1,
    totalCount: 5,
    weakCount: 2,
    recommendation: 'study',
    feedback: '第一单元需要先回看薄弱知识。',
    linkedPlanId: 'plan-first',
    linkedPlanStatus: 'in_progress',
    linkedReportAvailable: false,
    ...overrides,
  };
}

function makeDiagnosticAttemptDetail(
  overrides: Partial<ScopeDiagnosticAttemptDetail> = {},
): ScopeDiagnosticAttemptDetail {
  return {
    attemptId: 'attempt-first',
    studentId: 'student-1',
    scopeType: 'chapter',
    scopeId: '第一章 运动的描述',
    scopeName: '第一单元',
    diagnosticType: 'scope',
    status: 'submitted',
    createdAt: '2026-06-25T02:00:00Z',
    submittedAt: '2026-06-25T02:05:00Z',
    questionIds: ['q-1', 'q-2', 'q-3'],
    answerIds: [1, 2, 3],
    result: null,
    correctCount: 1,
    totalCount: 5,
    weakCount: 2,
    weakKpIds: ['kp-weak-1', 'kp-weak-2'],
    recommendation: 'study',
    feedback: '第一单元当时暴露了坐标系和速度概念不稳。',
    kpResults: [
      {
        id: 'attempt-kp-1',
        kpId: 'kp-weak-1',
        kpName: '坐标系',
        groupId: '第一章 运动的描述||1.1 质点 参考系',
        groupName: '1.1 质点 参考系',
        correctCount: 0,
        totalCount: 2,
        masteryBefore: 0.12,
        masteryAfter: 0.21,
        isWeak: true,
      },
      {
        id: 'attempt-kp-2',
        kpId: 'kp-stable-1',
        kpName: '质点',
        groupId: '第一章 运动的描述||1.1 质点 参考系',
        groupName: '1.1 质点 参考系',
        correctCount: 1,
        totalCount: 1,
        masteryBefore: 0.4,
        masteryAfter: 0.8,
        isWeak: false,
      },
    ],
    linkedPlanId: 'plan-first',
    linkedPlanStatus: 'in_progress',
    linkedReportAvailable: false,
    ...overrides,
  };
}

function makeLearningTraceEvent(
  overrides: Partial<LearningTraceEvent> = {},
): LearningTraceEvent {
  return {
    id: 'trace-diagnostic-1',
    eventType: 'diagnostic_submitted',
    eventTime: '2026-06-27T02:00:00Z',
    studentId: 'student-1',
    scopeType: 'chapter',
    scopeId: '第一章 运动的描述',
    scopeName: '第一单元',
    title: '完成「第一单元」单元检测',
    description: '正确 1/5，发现 2 个薄弱点。',
    attemptId: 'attempt-first',
    planId: null,
    taskId: null,
    retestAttemptId: null,
    kpId: null,
    kpName: null,
    statusLabel: '检测完成',
    primaryAction: 'view_diagnostic',
    reportAvailable: false,
    metadata: { correctCount: 1, totalCount: 5, weakCount: 2 },
    ...overrides,
  };
}

describe('TrainPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    studentIdentityMock.profile = {
      id: 'student-1',
      username: 'student',
      display_name: '学生',
      status: 'active',
      account_source: 'self_registered',


    };
    vi.mocked(api.getTrainStart).mockResolvedValue(trainStart);
    vi.mocked(api.getDirectory).mockResolvedValue(directory);
    vi.mocked(api.scopeDiagnose).mockResolvedValue({
      ...practiceSession,
      session_type: 'scope_diagnostic',
      strategy: 'scope_diagnostic',
      session_objective: '本章掌握评估',
    });
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue({
      scope_type: 'chapter',
      scope_id: '运动的描述',
      scope_name: '运动的描述',
      kp_results: [{
        kp_id: 'kp-1',
        kp_name: '质点',
        correct_count: 1,
        total_count: 1,
        mastery_before: 0.1,
        mastery_after: 0.76,
      }],
      correct_count: 1,
      total_count: 1,
      weak_kp_ids: [],
      recommendation: 'practice',
      feedback: '后端定位反馈',
    });
    vi.mocked(api.createImprovementPlanFromScopeResult).mockRejectedValue(new Error('server plan unavailable'));
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(null);
    vi.mocked(api.getImprovementPlan).mockRejectedValue(new Error('not mocked'));
    vi.mocked(api.updateImprovementTaskStatus).mockRejectedValue(new Error('not mocked'));
    vi.mocked(api.moveToNextImprovementTaskOnServer).mockRejectedValue(new Error('not mocked'));
    vi.mocked(api.startImprovementRetest).mockRejectedValue(new Error('not mocked'));
    vi.mocked(api.submitImprovementRetestFeedback).mockRejectedValue(new Error('not mocked'));
    vi.mocked((api as any).getImprovementReport).mockRejectedValue(new Error('not mocked'));
    vi.mocked((api as any).getLatestCompletedImprovementReport).mockResolvedValue(null);
    vi.mocked((api as any).listImprovementReports).mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });
    vi.mocked(api.listScopeDiagnosticAttempts).mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });
    vi.mocked(api.getScopeDiagnosticAttempt).mockRejectedValue(new Error('not mocked'));
    vi.mocked(api.listLearningTrace).mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({ items: [] });
    vi.mocked(api.getScopeKnowledgeMasteryJudgments).mockResolvedValue({
      scopeType: 'chapter',
      scopeId: '运动的描述',
      scopeName: '运动的描述',
      items: [],
    });
  });

  it('stops loading after an entry failure and only retries on request', async () => {
    vi.mocked(api.getDirectory).mockRejectedValueOnce(new Error('目录加载失败'));
    render(<MemoryRouter initialEntries={['/train']}><TrainPage /></MemoryRouter>);

    expect(await screen.findByText('目录加载失败')).toBeInTheDocument();
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument();
    expect(api.getDirectory).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    expect(api.getDirectory).toHaveBeenCalledTimes(2);
  });

  it('keeps consolidation entry visible without auto-starting a diagnostic session', async () => {
    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    expect(screen.getByText('单元检测')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始检测' })).toBeInTheDocument();
  });

  it('selects the recently learned chapter without showing an extra current suggestion card', async () => {
    vi.mocked(api.getTrainStart).mockResolvedValue({
      is_first_time: false,
      has_diagnosed: true,
      recommended_kps: [],
    });
    vi.mocked(api.getDirectory).mockResolvedValue(directoryWithRecentElectiveChapter);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('选必二 · 电磁感应')).toBeInTheDocument();
    expect(screen.queryByText('当前建议')).not.toBeInTheDocument();
    expect(screen.queryByText('最近学习到这里，建议继续完成本章巩固。')).not.toBeInTheDocument();
  });

  it('organizes consolidation entry as a curriculum control panel plus chapter training path', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('学习控制面板')).toBeInTheDocument();
    expect(api.getDirectory).toHaveBeenCalledWith('student-1');
    expect(screen.getByText('选择教材与章节')).toBeInTheDocument();
    expect(screen.getByText('0/1 已掌握 · 0% 平均掌握')).toBeInTheDocument();
    expect(screen.getByText('当前章节训练路径')).toBeInTheDocument();
    expect(screen.queryByText('当前建议')).not.toBeInTheDocument();
    expect(screen.queryByText('第 1 章')).not.toBeInTheDocument();
    expect(container.querySelector('.train-route-step-number')).toBeNull();
  });

  it('keeps the recent scope result before the diagnostic history area inside the right session panel', async () => {
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(makeReadyForRetestPlan());

    const { container } = render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    expect(screen.getByText('当前章节训练路径')).toBeInTheDocument();

    const sessionPanel = container.querySelector('.train-session-panel');
    const recentScopeCard = sessionPanel?.querySelector('.train-recent-scope-card');
    const routeCard = sessionPanel?.querySelector('.train-route-card');

    expect(sessionPanel).not.toBeNull();
    expect(recentScopeCard).not.toBeNull();
    expect(routeCard).not.toBeNull();
    expect(Array.from(sessionPanel?.children || []).indexOf(recentScopeCard as Element)).toBeLessThan(
      Array.from(sessionPanel?.children || []).indexOf(routeCard as Element),
    );
  });

  it('styles the entry session panel as a vertical stack', () => {
    const sessionPanelRule = cssRules('.train-session-panel').find(rule => rule.includes('display: flex')) || '';
    const sessionPanelCardRule = cssRules('.train-session-panel > .card').find(rule => rule.includes('margin-bottom: 0')) || '';
    const routeCardRule = cssRules('.train-route-card').find(rule => rule.includes('flex: 1 1 auto')) || '';
    const routeStepsRule = cssRules('.train-route-steps').find(rule => rule.includes('flex: 1')) || '';
    const scopeCardRule = cssRules('.train-recent-scope-card').find(rule => rule.includes('flex-direction: column')) || '';
    const scopeActionsRule = cssRules('.train-recent-scope-actions').find(rule => rule.includes('width: 100%')) || '';
    const judgmentSummaryCardRule = cssRules('.train-judgment-summary-card').find(rule => rule.includes('flex-shrink: 0')) || '';

    expect(sessionPanelRule).toContain('display: flex');
    expect(sessionPanelRule).toContain('flex-direction: column');
    expect(sessionPanelRule).toContain('gap: 10px');
    expect(sessionPanelCardRule).toContain('margin-bottom: 0');
    expect(routeCardRule).toContain('display: flex');
    expect(routeCardRule).toContain('flex: 1 1 auto');
    expect(routeCardRule).toContain('flex-direction: column');
    expect(routeCardRule).not.toContain('height: 100%');
    expect(routeStepsRule).toContain('flex: 1');
    expect(scopeCardRule).toContain('flex-direction: column');
    expect(scopeCardRule).toContain('flex-shrink: 0');
    expect(scopeCardRule).toContain('width: 100%');
    expect(scopeActionsRule).toContain('width: 100%');
    expect(judgmentSummaryCardRule).toContain('flex-shrink: 0');
    expect(judgmentSummaryCardRule).toContain('width: 100%');
  });

  it('keeps an active plan entry focused on the concrete improvement card', async () => {
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(makeServerPlan(weakScopeResult as ScopeDiagnosticResult));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    expect(screen.getByText('推荐先修复「后端推荐任务」')).toBeInTheDocument();
    expect(screen.queryByText('学习状态摘要')).not.toBeInTheDocument();
    expect(api.getKnowledgeMasteryJudgments).not.toHaveBeenCalled();
    expect(screen.queryByText('in_improvement')).not.toBeInTheDocument();
  });

  it('keeps a ready-for-retest entry focused on the existing improvement card', async () => {
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(makeReadyForRetestPlan());

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    expect(screen.queryByText('学习状态摘要')).not.toBeInTheDocument();
    expect(api.getKnowledgeMasteryJudgments).not.toHaveBeenCalled();
  });

  it('uses scope judgments on entry when there is no active plan', async () => {
    vi.mocked(api.getScopeKnowledgeMasteryJudgments).mockResolvedValue({
      scopeType: 'chapter',
      scopeId: '运动的描述',
      scopeName: '运动的描述',
      items: [
        makeJudgment({
          kpId: 'kp-1',
          kpName: '质点',
          masteryLevel: 'weak',
          interventionStatus: 'needs_practice',
          nextAction: 'diagnose',
          reason: '建议先完成检测，再进入针对练习。',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('学习状态摘要')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.getScopeKnowledgeMasteryJudgments).toHaveBeenCalledWith('chapter', '运动的描述', 'student-1');
    });
    expect(screen.getByText('这个范围还有 1 个知识点需要重点巩固。')).toBeInTheDocument();
    expect(screen.getByText('薄弱 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始检测' })).toBeInTheDocument();
  });

  it('keeps low-confidence judgments cautious on the train entry', async () => {
    vi.mocked(api.getScopeKnowledgeMasteryJudgments).mockResolvedValue({
      scopeType: 'chapter',
      scopeId: '运动的描述',
      scopeName: '运动的描述',
      items: [
        makeJudgment({
          kpId: 'kp-1',
          confidence: 'low',
          masteryLevel: 'weak',
          interventionStatus: 'needs_learning',
          nextAction: 'learn',
          reason: '证据较少。',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('学习状态摘要')).toBeInTheDocument();
    expect(screen.getByText('部分知识点证据较少，建议先完成一次检测。')).toBeInTheDocument();
    expect(screen.getByText('证据较少 1')).toBeInTheDocument();
    expect(screen.queryByText('薄弱 1')).not.toBeInTheDocument();
  });

  it('keeps plain train entry cards when judgment loading fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(api.getScopeKnowledgeMasteryJudgments).mockRejectedValue(new Error('judgment offline'));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('当前章节训练路径')).toBeInTheDocument();
    expect(screen.getByText('检测历史')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看检测历史' })).toBeInTheDocument();
    expect(screen.queryByText('学习轨迹')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith('加载巩固提升掌握判读失败', expect.any(Error));
    });
    expect(screen.queryByText('学习状态摘要')).not.toBeInTheDocument();

    warnSpy.mockRestore();
  });

  it('loads task mastery judgments for the improvement path without showing status badges', async () => {
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(makeServerPlan(weakScopeResult as ScopeDiagnosticResult));
    vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({
      items: [
        makeJudgment({
          kpId: 'kp-server',
          kpName: '后端推荐任务',
          masteryLevel: 'developing',
          interventionStatus: 'in_improvement',
          nextAction: 'continue_improvement',
        }),
        makeJudgment({
          kpId: 'kp-server-next',
          kpName: '后端下一任务',
          masteryLevel: 'stable',
          interventionStatus: 'awaiting_retest',
          nextAction: 'retest',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));

    expect(await screen.findByText('提升路径')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.getKnowledgeMasteryJudgments).toHaveBeenCalledWith(
        expect.arrayContaining(['kp-server', 'kp-server-next']),
        'student-1',
      );
    });
    expect(screen.queryByLabelText(/统一判断：/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: /掌握度/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText('in_improvement')).not.toBeInTheDocument();
    expect(screen.queryByText('awaiting_retest')).not.toBeInTheDocument();
  });

  it('keeps the improvement path detail usable when task judgment loading fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(makeServerPlan(weakScopeResult as ScopeDiagnosticResult));
    vi.mocked(api.getKnowledgeMasteryJudgments).mockRejectedValue(new Error('detail judgment offline'));

    const { container } = render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));

    expect(await screen.findByText('提升路径')).toBeInTheDocument();
    expect(screen.getByText('后端推荐任务')).toBeInTheDocument();
    expect(screen.queryByLabelText(/统一判断：/)).not.toBeInTheDocument();
    expect(container.querySelector('.train-task-judgment-badge.is-placeholder')).toBeNull();
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith('加载提升路径掌握判读失败', expect.any(Error));
    });

    warnSpy.mockRestore();
  });

  it('keeps initial consolidation focused on diagnostic before showing remediation actions', async () => {
    vi.mocked(api.getTrainStart).mockResolvedValue({
      is_first_time: false,
      has_diagnosed: true,
      recommended_kps: [
        { kp_id: 'kp-1', kp_name: '质点', mastery: 0.2, reason: '近期练习暴露薄弱' },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始检测' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '专项练' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始提升' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '回看知识' })).not.toBeInTheDocument();
  });

  it('keeps curriculum stats in the training path instead of the left control panel', async () => {
    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('章节训练统计')).toBeInTheDocument();
    expect(screen.queryByLabelText('教材巩固概览')).not.toBeInTheDocument();
    expect(screen.queryByText('必修一章节')).not.toBeInTheDocument();
  });

  it('shows the latest completed improvement report card on the entry page', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getLatestCompletedImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近提升报告')).toBeInTheDocument();
    expect(screen.getByText('「运动的描述」提升闭环已完成')).toBeInTheDocument();
    expect(screen.getByText('已通过 2/2')).toBeInTheDocument();
    expect(screen.getByText('复测正确率 100%')).toBeInTheDocument();
  });

  it('keeps a completed report entry focused on the report card', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getLatestCompletedImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近提升报告')).toBeInTheDocument();
    expect(screen.queryByText('学习状态摘要')).not.toBeInTheDocument();
    expect(api.getKnowledgeMasteryJudgments).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '查看报告' })).toBeInTheDocument();
  });

  it('loads an improvement report from the report URL before any kp auto practice', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));

    render(
      <MemoryRouter initialEntries={['/train?report=server-plan-1&kp=kp-1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect((api as any).getImprovementReport).toHaveBeenCalledWith('server-plan-1', 'student-1');
    });
    expect(await screen.findByText('提升报告')).toBeInTheDocument();
    expect(screen.getByText('「运动的描述」本轮提升已完成')).toBeInTheDocument();
    expect(api.getPracticeSession).not.toHaveBeenCalled();
    expect(api.getKnowledgeMasteryJudgments).not.toHaveBeenCalled();
    expect(api.getScopeKnowledgeMasteryJudgments).not.toHaveBeenCalled();
  });

  it('loads report history from the report_history URL', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).listImprovementReports).mockResolvedValue({
      items: [makeReportListItem(completedPlan, { planId: 'history-plan-1', scopeName: '历史章节' })],
      total: 1,
      limit: 10,
      offset: 0,
    });

    render(
      <MemoryRouter initialEntries={['/train?report_history=1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect((api as any).listImprovementReports).toHaveBeenCalledWith('student-1', { limit: 10, offset: 0 });
    });
    expect(api.getKnowledgeMasteryJudgments).not.toHaveBeenCalled();
    expect(api.getScopeKnowledgeMasteryJudgments).not.toHaveBeenCalled();
    expect(await screen.findByText('提升报告历史')).toBeInTheDocument();
    expect(screen.getByText('历史章节')).toBeInTheDocument();
  });

  it('opens the latest completed improvement report from the entry card', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getLatestCompletedImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近提升报告')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看报告' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?report=server-plan-1');
    });
    await waitFor(() => {
      expect((api as any).getImprovementReport).toHaveBeenCalledWith('server-plan-1', 'student-1');
    });
    expect(await screen.findByText('提升报告')).toBeInTheDocument();
  });

  it('opens report history and can enter a report from a history item', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getLatestCompletedImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));
    vi.mocked((api as any).listImprovementReports).mockResolvedValue({
      items: [makeReportListItem(completedPlan, { planId: 'history-plan-1', scopeName: '历史章节' })],
      total: 1,
      limit: 10,
      offset: 0,
    });
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport({
      ...completedPlan,
      id: 'history-plan-1',
      scopeName: '历史章节',
    }));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近提升报告')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看历史报告' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?report_history=1');
    });
    expect(await screen.findByText('提升报告历史')).toBeInTheDocument();
    expect(screen.getByText('历史章节')).toBeInTheDocument();
    expect(screen.getByText('已通过 2/2 个提升任务')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看报告' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?report=history-plan-1');
    });
    await waitFor(() => {
      expect((api as any).getImprovementReport).toHaveBeenCalledWith('history-plan-1', 'student-1');
    });
    expect(await screen.findByText('「历史章节」本轮提升已完成')).toBeInTheDocument();
  });

  it('prints the loaded improvement report from the report page', async () => {
    const printMock = vi.fn();
    Object.defineProperty(window, 'print', { configurable: true, value: printMock });
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));

    render(
      <MemoryRouter initialEntries={['/train?report=server-plan-1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('提升报告')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '打印报告' }));

    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it('copies the improvement report summary for lightweight sharing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));

    render(
      <MemoryRouter initialEntries={['/train?report=server-plan-1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('提升报告')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '复制摘要' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('OpenPhysics 提升报告'));
    });
    expect(await screen.findByText('报告摘要已复制')).toBeInTheDocument();
  });

  it('shows copy failure feedback when the clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));

    render(
      <MemoryRouter initialEntries={['/train?report=server-plan-1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('提升报告')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '复制摘要' }));

    expect(await screen.findByText('复制失败，请手动选择报告内容')).toBeInTheDocument();
  });

  it('shows a recoverable error when a report URL cannot be loaded', async () => {
    vi.mocked((api as any).getImprovementReport).mockRejectedValue(new Error('report offline'));

    render(
      <MemoryRouter initialEntries={['/train?report=server-plan-1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('提升报告加载失败：report offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回巩固提升首页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试加载' })).toBeInTheDocument();
  });

  it('clears the report URL when returning from a directly loaded report', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));

    render(
      <MemoryRouter initialEntries={['/train?report=server-plan-1']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('提升报告')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '回到巩固提升首页' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    });
    expect(await screen.findByText('当前章节训练路径')).toBeInTheDocument();
    expect((api as any).getImprovementReport).toHaveBeenCalledTimes(1);
  });

  it('clears the report URL before starting a new diagnostic from the report page', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));

    render(
      <MemoryRouter initialEntries={['/train?report=server-plan-1']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('提升报告')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重新检测' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
      expect(api.scopeDiagnose).toHaveBeenCalledWith('chapter', '运动的描述', 10, 'student-1');
    });
  });

  it('clears the report history URL when returning from a direct history URL', async () => {
    render(
      <MemoryRouter initialEntries={['/train?report_history=1']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('提升报告历史')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    });
    expect(await screen.findByText('当前章节训练路径')).toBeInTheDocument();
  });

  it('shows a recoverable error when report history loading fails', async () => {
    vi.mocked((api as any).listImprovementReports).mockRejectedValue(new Error('history offline'));

    render(
      <MemoryRouter initialEntries={['/train?report_history=1']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('提升报告历史加载失败：history offline')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回巩固提升首页' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    });
    expect(await screen.findByText('当前章节训练路径')).toBeInTheDocument();
  });

  it('shows an empty state in report history', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getLatestCompletedImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));
    vi.mocked((api as any).listImprovementReports).mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近提升报告')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看历史报告' }));

    expect(await screen.findByText('暂无提升报告')).toBeInTheDocument();
    expect(screen.getByText('完成一次阶段复测后，会在这里生成报告。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
  });

  it('loads more completed improvement reports in history', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked((api as any).getLatestCompletedImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));
    vi.mocked((api as any).listImprovementReports)
      .mockResolvedValueOnce({
        items: [makeReportListItem(completedPlan, { planId: 'history-plan-1', scopeName: '第一条报告' })],
        total: 2,
        limit: 10,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: [makeReportListItem(completedPlan, { planId: 'history-plan-2', scopeName: '第二条报告' })],
        total: 2,
        limit: 10,
        offset: 1,
      });

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近提升报告')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看历史报告' }));

    expect(await screen.findByText('第一条报告')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }));

    expect(await screen.findByText('第二条报告')).toBeInTheDocument();
    expect((api as any).listImprovementReports).toHaveBeenLastCalledWith('student-1', { limit: 10, offset: 1 });
  });

  it('keeps the entry page usable when the latest completed report fails to load', async () => {
    vi.mocked((api as any).getLatestCompletedImprovementReport).mockRejectedValue(new Error('report unavailable'));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('当前章节训练路径')).toBeInTheDocument();
    expect(screen.queryByText('report unavailable')).not.toBeInTheDocument();
    expect((api as any).getLatestCompletedImprovementReport).toHaveBeenCalledWith('student-1');
  });

  it('keeps active improvement plan and completed report entry visible together', async () => {
    const activePlan = makeServerPlan(weakScopeResult as ScopeDiagnosticResult);
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(activePlan);
    vi.mocked((api as any).getLatestCompletedImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    expect(screen.getByText('最近提升报告')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续薄弱点提升' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看报告' })).toBeInTheDocument();
  });

  it('keeps the diagnostic history entry under the current unit diagnostic card', async () => {
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(makeServerPlan(weakScopeResult as ScopeDiagnosticResult));

    const { container } = render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    expect(screen.queryByText('回看历史检测记录')).not.toBeInTheDocument();

    const recentScopeCard = container.querySelector('.train-recent-scope-card');
    const routeSteps = container.querySelector('.train-route-steps');
    const unitDiagnostic = container.querySelector('.train-route-step-action');
    const historyEntry = container.querySelector('.train-route-history-entry');
    const historyButton = screen.getByRole('button', { name: '查看检测历史' });
    const actionLabels = Array.from(
      recentScopeCard?.querySelectorAll('.train-recent-scope-actions button') || [],
    ).map(button => button.textContent?.trim());
    expect(recentScopeCard).not.toBeNull();
    expect(routeSteps).not.toBeNull();
    expect(unitDiagnostic).not.toBeNull();
    expect(historyEntry).not.toBeNull();
    expect(routeSteps).toContainElement(historyButton);
    expect(recentScopeCard).not.toContainElement(historyButton);
    expect(actionLabels).toEqual(['查看检测结果', '继续薄弱点提升', '重新检测']);
    expect(Array.from(routeSteps?.children || []).indexOf(historyEntry as Element)).toBeGreaterThan(
      Array.from(routeSteps?.children || []).indexOf(unitDiagnostic as Element),
    );
  });

  it('shows diagnostic history as a secondary entry under the unit diagnostic on the consolidation entry page', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    expect(screen.getByText('检测历史')).toBeInTheDocument();
    expect(screen.queryByText('查看每次章节 / 单元检测结果，回顾薄弱点和对应提升路径。')).not.toBeInTheDocument();
    expect(container.querySelector('.train-route-history-entry')).not.toBeNull();
    expect(container.querySelector('.train-route-steps')).toContainElement(
      screen.getByRole('button', { name: '查看检测历史' }),
    );
  });

  it('does not show a learning trace entry point on the consolidation entry page', async () => {
    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看学习轨迹' })).not.toBeInTheDocument();
    expect(screen.queryByText('按时间查看学习闭环')).not.toBeInTheDocument();
  });

  it('loads learning trace from the learning_trace URL before any kp auto practice', async () => {
    vi.mocked(api.listLearningTrace).mockResolvedValue({
      items: [makeLearningTraceEvent()],
      total: 1,
      limit: 20,
      offset: 0,
    });

    render(
      <MemoryRouter initialEntries={['/train?learning_trace=1&kp=kp-1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.listLearningTrace).toHaveBeenCalledWith('student-1', { limit: 20, offset: 0 });
    });
    expect(api.getKnowledgeMasteryJudgments).not.toHaveBeenCalled();
    expect(api.getScopeKnowledgeMasteryJudgments).not.toHaveBeenCalled();
    expect(await screen.findByText('学习轨迹')).toBeInTheDocument();
    expect(api.getPracticeSession).not.toHaveBeenCalled();
  });

  it('opens linked diagnostic, plan, and report actions from learning trace events', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    const linkedPlan = makeServerPlan(weakScopeResult as ScopeDiagnosticResult, {
      id: 'plan-first',
      scopeName: '第一单元',
    });
    vi.mocked(api.listLearningTrace).mockResolvedValue({
      items: [
        makeLearningTraceEvent({
          id: 'trace-diagnostic-1',
          title: '完成「第一单元」单元检测',
          attemptId: 'attempt-first',
          primaryAction: 'view_diagnostic',
        }),
        makeLearningTraceEvent({
          id: 'trace-plan-1',
          eventType: 'improvement_plan_created',
          eventTime: '2026-06-27T02:10:00Z',
          title: '生成「第一单元」提升路径',
          attemptId: 'attempt-first',
          planId: 'plan-first',
          primaryAction: 'view_plan',
          statusLabel: '已生成提升路径',
        }),
        makeLearningTraceEvent({
          id: 'trace-report-1',
          eventType: 'improvement_completed',
          eventTime: '2026-06-27T03:00:00Z',
          title: '完成「第一单元」提升闭环',
          planId: 'plan-first',
          primaryAction: 'view_report',
          reportAvailable: true,
          statusLabel: '已完成',
        }),
      ],
      total: 3,
      limit: 20,
      offset: 0,
    });
    vi.mocked(api.getScopeDiagnosticAttempt).mockResolvedValue(makeDiagnosticAttemptDetail());
    vi.mocked(api.getImprovementPlan).mockResolvedValue(linkedPlan);
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport({
      ...completedPlan,
      id: 'plan-first',
      scopeName: '第一单元',
    }));

    const renderLearningTracePage = () => render(
      <MemoryRouter initialEntries={['/train?learning_trace=1']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    const diagnosticView = renderLearningTracePage();
    expect(await screen.findByText('学习轨迹')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    await waitFor(() => {
      expect(api.getScopeDiagnosticAttempt).toHaveBeenCalledWith('attempt-first', 'student-1');
      expect(screen.getByTestId('location-search')).toHaveTextContent('?diagnostic_attempt=attempt-first');
    });
    expect(await screen.findByText('检测结果')).toBeInTheDocument();
    diagnosticView.unmount();

    vi.mocked(api.listLearningTrace).mockResolvedValueOnce({
      items: [
        makeLearningTraceEvent({
          id: 'trace-plan-1',
          eventType: 'improvement_plan_created',
          title: '生成「第一单元」提升路径',
          planId: 'plan-first',
          primaryAction: 'view_plan',
          statusLabel: '已生成提升路径',
        }),
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
    const planView = renderLearningTracePage();
    await userEvent.click(await screen.findByRole('button', { name: '查看提升路径' }));
    await waitFor(() => {
      expect(api.getImprovementPlan).toHaveBeenCalledWith('plan-first', 'student-1');
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    });
    expect(await screen.findByText('提升路径')).toBeInTheDocument();
    planView.unmount();

    vi.mocked(api.listLearningTrace).mockResolvedValueOnce({
      items: [
        makeLearningTraceEvent({
          id: 'trace-report-1',
          eventType: 'improvement_completed',
          title: '完成「第一单元」提升闭环',
          planId: 'plan-first',
          primaryAction: 'view_report',
          reportAvailable: true,
          statusLabel: '已完成',
        }),
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
    renderLearningTracePage();
    await userEvent.click(await screen.findByRole('button', { name: '查看提升报告' }));
    await waitFor(() => {
      expect((api as any).getImprovementReport).toHaveBeenCalledWith('plan-first', 'student-1');
      expect(screen.getByTestId('location-search')).toHaveTextContent('?report=plan-first');
    });
    expect(await screen.findByText('「第一单元」本轮提升已完成')).toBeInTheDocument();
  });

  it('shows an empty state in learning trace', async () => {
    vi.mocked(api.listLearningTrace).mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });

    render(
      <MemoryRouter initialEntries={['/train?learning_trace=1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('暂无学习轨迹')).toBeInTheDocument();
    expect(screen.getByText('完成一次检测、提升或复测后，会在这里生成时间线。')).toBeInTheDocument();
  });

  it('loads more learning trace events', async () => {
    vi.mocked(api.listLearningTrace)
      .mockResolvedValueOnce({
        items: [makeLearningTraceEvent({ id: 'trace-first', title: '第一条轨迹' })],
        total: 2,
        limit: 20,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: [makeLearningTraceEvent({ id: 'trace-second', title: '第二条轨迹' })],
        total: 2,
        limit: 20,
        offset: 1,
      });

    render(
      <MemoryRouter initialEntries={['/train?learning_trace=1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('第一条轨迹')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }));

    expect(await screen.findByText('第二条轨迹')).toBeInTheDocument();
    expect(api.listLearningTrace).toHaveBeenLastCalledWith('student-1', { limit: 20, offset: 1 });
  });

  it('opens diagnostic history from the entry page and shows multiple units', async () => {
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(makeServerPlan(weakScopeResult as ScopeDiagnosticResult));
    vi.mocked(api.listScopeDiagnosticAttempts).mockResolvedValue({
      items: [
        makeDiagnosticHistoryItem({
          attemptId: 'attempt-second',
          scopeName: '第二单元',
          submittedAt: '2026-06-26T02:05:00Z',
          correctCount: 2,
          totalCount: 6,
          weakCount: 1,
          feedback: '第二单元需要继续练习。',
        }),
        makeDiagnosticHistoryItem({
          attemptId: 'attempt-first',
          scopeName: '第一单元',
          submittedAt: '2026-06-25T02:05:00Z',
        }),
      ],
      total: 2,
      limit: 10,
      offset: 0,
    });

    render(
      <MemoryRouter initialEntries={['/train']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: '查看检测历史' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测历史' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?diagnostic_history=1');
    });
    await waitFor(() => {
      expect(api.listScopeDiagnosticAttempts).toHaveBeenCalledWith('student-1', { limit: 10, offset: 0 });
    });
    expect(await screen.findByText('第一单元')).toBeInTheDocument();
    expect(screen.getByText('第二单元')).toBeInTheDocument();
    expect(screen.getByText('第一单元')).toBeInTheDocument();
  });

  it('loads diagnostic history from the diagnostic_history URL', async () => {
    vi.mocked(api.listScopeDiagnosticAttempts).mockResolvedValue({
      items: [makeDiagnosticHistoryItem({ attemptId: 'attempt-first', scopeName: '第一单元' })],
      total: 1,
      limit: 10,
      offset: 0,
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/train?diagnostic_history=1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.listScopeDiagnosticAttempts).toHaveBeenCalledWith('student-1', { limit: 10, offset: 0 });
    });
    expect(api.getKnowledgeMasteryJudgments).not.toHaveBeenCalled();
    expect(api.getScopeKnowledgeMasteryJudgments).not.toHaveBeenCalled();
    expect(await screen.findByText('检测历史')).toBeInTheDocument();
    expect(screen.getByText('第一单元')).toBeInTheDocument();
    expect(screen.getByText('对应提升路径')).toBeInTheDocument();
    const historyHeader = container.querySelector('.train-diagnostic-history-header');
    expect(historyHeader).not.toBeNull();
    expect(historyHeader).toContainElement(screen.getByRole('button', { name: '返回' }));
    expect(historyHeader).not.toContainElement(screen.getByText('第一单元'));
    expect(cssRule('.train-diagnostic-history-header-card')).toContain('padding: 16px 18px');
    expect(cssRule('.train-diagnostic-history-panel')).toContain('gap: 10px');
    expect(cssRule('.train-diagnostic-history-panel > .train-complete-card')).toContain('margin-bottom: 0');
    const historyRecordPanel = container.querySelector('.train-diagnostic-history-records-panel');
    expect(historyRecordPanel).not.toBeNull();
    expect(historyRecordPanel).toContainElement(screen.getByText('第一单元'));
    expect(historyRecordPanel).toHaveTextContent('已显示 1/1');
    expect(container.querySelector('.train-diagnostic-history-panel .train-footer-actions')).not.toBeInTheDocument();
    expect(screen.queryByText('提升中')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看检测结果' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看第一单元提升路径' })).toBeInTheDocument();
  });

  it('opens the linked improvement path by clicking a diagnostic history card with a plan', async () => {
    const linkedPlan = makeServerPlan(weakScopeResult as ScopeDiagnosticResult, {
      id: 'plan-first',
      scopeName: '第一单元',
    });
    vi.mocked(api.listScopeDiagnosticAttempts).mockResolvedValue({
      items: [
        makeDiagnosticHistoryItem({ attemptId: 'attempt-second', scopeName: '第二单元' }),
        makeDiagnosticHistoryItem({ attemptId: 'attempt-first', scopeName: '第一单元' }),
      ],
      total: 2,
      limit: 10,
      offset: 0,
    });
    vi.mocked(api.getImprovementPlan).mockResolvedValue(linkedPlan);

    render(
      <MemoryRouter initialEntries={['/train?diagnostic_history=1']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('第一单元')).toBeInTheDocument();
    expect(screen.queryByText('提升中')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看检测结果' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看提升路径' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看第一单元提升路径' }));

    await waitFor(() => {
      expect(api.getImprovementPlan).toHaveBeenCalledWith('plan-first', 'student-1');
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    });
    expect(api.getScopeDiagnosticAttempt).not.toHaveBeenCalled();
    expect(await screen.findByText('提升路径')).toBeInTheDocument();
    expect(screen.getByText('推荐下一步：先处理「后端推荐任务」。')).toBeInTheDocument();
  });

  it('shows a stable improvement path loading state after clicking linked diagnostic history', async () => {
    const linkedPlan = makeServerPlan(weakScopeResult as ScopeDiagnosticResult, {
      id: 'plan-first',
      scopeName: '第一单元',
    });
    let resolvePlan: (plan: ImprovementPlan) => void = () => undefined;
    vi.mocked(api.listScopeDiagnosticAttempts).mockResolvedValue({
      items: [makeDiagnosticHistoryItem({ attemptId: 'attempt-first', scopeName: '第一单元' })],
      total: 1,
      limit: 10,
      offset: 0,
    });
    vi.mocked(api.getImprovementPlan).mockImplementation(() => new Promise((resolve) => {
      resolvePlan = resolve;
    }));

    render(
      <MemoryRouter initialEntries={['/train?diagnostic_history=1']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('第一单元')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看第一单元提升路径' }));

    expect(await screen.findByText('加载提升路径...')).toBeInTheDocument();
    expect(screen.queryByText('检测历史')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '巩固提升' })).not.toBeInTheDocument();

    await act(async () => {
      resolvePlan(linkedPlan);
    });

    await waitFor(() => {
      expect(api.getImprovementPlan).toHaveBeenCalledWith('plan-first', 'student-1');
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    });
    expect(await screen.findByText('提升路径')).toBeInTheDocument();
  });

  it('opens a diagnostic record from history when the card has no linked plan', async () => {
    vi.mocked(api.listScopeDiagnosticAttempts).mockResolvedValue({
      items: [
        makeDiagnosticHistoryItem({
          attemptId: 'attempt-first',
          scopeName: '第一单元',
          linkedPlanId: null,
          linkedPlanStatus: null,
          linkedReportAvailable: false,
        }),
      ],
      total: 1,
      limit: 10,
      offset: 0,
    });
    vi.mocked(api.getScopeDiagnosticAttempt).mockResolvedValue(makeDiagnosticAttemptDetail({
      linkedPlanId: null,
      linkedPlanStatus: null,
      linkedReportAvailable: false,
    }));

    render(
      <MemoryRouter initialEntries={['/train?diagnostic_history=1']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('第一单元')).toBeInTheDocument();
    expect(screen.getByText('检测记录')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看第一单元检测记录' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看第一单元检测记录' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?diagnostic_attempt=attempt-first');
    });
    await waitFor(() => {
      expect(api.getScopeDiagnosticAttempt).toHaveBeenCalledWith('attempt-first', 'student-1');
    });
    expect(await screen.findByText('检测结果')).toBeInTheDocument();
    expect(screen.getByText('第一单元 · 正确 1/5')).toBeInTheDocument();
    expect(screen.getByText('第一单元当时暴露了坐标系和速度概念不稳。')).toBeInTheDocument();
    expect(screen.getByText('坐标系')).toBeInTheDocument();
    expect(screen.getByText('质点')).toBeInTheDocument();
    expect(screen.getByText('薄弱')).toBeInTheDocument();
    expect(screen.getByText('稳定')).toBeInTheDocument();
  });

  it('loads a diagnostic attempt detail from the diagnostic_attempt URL without auto practice', async () => {
    vi.mocked(api.getScopeDiagnosticAttempt).mockResolvedValue(makeDiagnosticAttemptDetail());

    render(
      <MemoryRouter initialEntries={['/train?diagnostic_attempt=attempt-first&kp=kp-1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.getScopeDiagnosticAttempt).toHaveBeenCalledWith('attempt-first', 'student-1');
    });
    expect(await screen.findByText('检测结果')).toBeInTheDocument();
    expect(screen.getByText('第一单元 · 正确 1/5')).toBeInTheDocument();
    expect(api.getPracticeSession).not.toHaveBeenCalled();
    expect(api.getKnowledgeMasteryJudgments).not.toHaveBeenCalled();
    expect(api.getScopeKnowledgeMasteryJudgments).not.toHaveBeenCalled();
  });

  it('opens a linked improvement path from diagnostic attempt detail', async () => {
    const linkedPlan = makeServerPlan(weakScopeResult as ScopeDiagnosticResult, {
      id: 'plan-first',
      scopeName: '第一单元',
    });
    vi.mocked(api.getScopeDiagnosticAttempt).mockResolvedValue(makeDiagnosticAttemptDetail({
      linkedPlanId: 'plan-first',
      linkedPlanStatus: 'in_progress',
      linkedReportAvailable: false,
    }));
    vi.mocked(api.getImprovementPlan).mockResolvedValue(linkedPlan);

    render(
      <MemoryRouter initialEntries={['/train?diagnostic_attempt=attempt-first']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看提升路径' }));

    await waitFor(() => {
      expect(api.getImprovementPlan).toHaveBeenCalledWith('plan-first', 'student-1');
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    });
    expect(await screen.findByText('提升路径')).toBeInTheDocument();
    expect(screen.getByText('推荐下一步：先处理「后端推荐任务」。')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: '回到检测结果' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '回到检测结果' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?diagnostic_attempt=attempt-first');
    });
    expect(await screen.findByText('检测结果')).toBeInTheDocument();
    expect(screen.getByText('第一单元 · 正确 1/5')).toBeInTheDocument();
  });

  it('opens a linked improvement report from diagnostic attempt detail', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked(api.getScopeDiagnosticAttempt).mockResolvedValue(makeDiagnosticAttemptDetail({
      linkedPlanId: 'plan-first',
      linkedPlanStatus: 'completed',
      linkedReportAvailable: true,
    }));
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport({
      ...completedPlan,
      id: 'plan-first',
      scopeName: '第一单元',
    }));

    render(
      <MemoryRouter initialEntries={['/train?diagnostic_attempt=attempt-first']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看提升报告' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?report=plan-first');
    });
    await waitFor(() => {
      expect((api as any).getImprovementReport).toHaveBeenCalledWith('plan-first', 'student-1');
    });
    expect(await screen.findByText('「第一单元」本轮提升已完成')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: '回到检测结果' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '回到检测结果' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?diagnostic_attempt=attempt-first');
    });
    expect(await screen.findByText('检测结果')).toBeInTheDocument();
    expect(screen.getByText('第一单元 · 正确 1/5')).toBeInTheDocument();
  });

  it('keeps linked path and report actions off the compact diagnostic history card', async () => {
    vi.mocked(api.listScopeDiagnosticAttempts).mockResolvedValue({
      items: [makeDiagnosticHistoryItem({
        attemptId: 'attempt-completed',
        linkedPlanId: 'plan-completed',
        linkedPlanStatus: 'completed',
        linkedReportAvailable: true,
      })],
      total: 1,
      limit: 10,
      offset: 0,
    });

    render(
      <MemoryRouter initialEntries={['/train?diagnostic_history=1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('第一单元')).toBeInTheDocument();
    expect(screen.queryByText('提升中')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看提升路径' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看提升报告' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看第一单元提升路径' })).toBeInTheDocument();
  });

  it('shows a fallback when diagnostic attempt detail has no knowledge-point rows', async () => {
    vi.mocked(api.getScopeDiagnosticAttempt).mockResolvedValue(makeDiagnosticAttemptDetail({
      feedback: null,
      result: null,
      kpResults: [],
      linkedPlanId: null,
      linkedPlanStatus: null,
      linkedReportAvailable: false,
    }));

    render(
      <MemoryRouter initialEntries={['/train?diagnostic_attempt=attempt-first']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('检测结果')).toBeInTheDocument();
    expect(screen.getByText('本次检测结果已记录。')).toBeInTheDocument();
    expect(screen.getByText('暂无知识点明细')).toBeInTheDocument();
    expect(screen.getByText('本次检测尚未关联提升路径')).toBeInTheDocument();
  });

  it('shows an empty state in diagnostic history', async () => {
    vi.mocked(api.listScopeDiagnosticAttempts).mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });

    render(
      <MemoryRouter initialEntries={['/train?diagnostic_history=1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('暂无检测记录')).toBeInTheDocument();
    expect(screen.getByText('完成一次章节或单元检测后，会在这里生成历史记录。')).toBeInTheDocument();
  });

  it('shows a recoverable error when diagnostic history loading fails', async () => {
    vi.mocked(api.listScopeDiagnosticAttempts).mockRejectedValue(new Error('diagnostic history offline'));

    render(
      <MemoryRouter initialEntries={['/train?diagnostic_history=1']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('检测历史加载失败：diagnostic history offline')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回巩固提升首页' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    });
    expect(await screen.findByText('当前章节训练路径')).toBeInTheDocument();
  });

  it('shows a recoverable error when diagnostic attempt loading fails', async () => {
    vi.mocked(api.getScopeDiagnosticAttempt).mockRejectedValue(new Error('attempt offline'));

    render(
      <MemoryRouter initialEntries={['/train?diagnostic_attempt=attempt-first']}>
        <LocationProbe />
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('检测结果加载失败：attempt offline')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回巩固提升首页' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    });
    expect(await screen.findByText('当前章节训练路径')).toBeInTheDocument();
  });

  it('shows backend recommended weak chapter even when mastery is still zero', async () => {
    vi.mocked(api.getTrainStart).mockResolvedValue({
      is_first_time: false,
      has_diagnosed: true,
      recommended_kps: [
        { kp_id: 'kp-1', kp_name: '质点', mastery: 0, reason: '近期练习暴露薄弱' },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('有薄弱').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('does not auto-start the target knowledge point again after returning from a direct practice session', async () => {
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train?kp=kp-1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('混合提升')).toBeInTheDocument();
    expect(screen.getByTestId('runner-title')).toHaveAttribute('data-deferred', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'runner back' }));

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledTimes(1);
    });
  });

  it('returns to sync page when target practice was opened from sync', async () => {
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/train',
            search: '?kp=kp-1',
            state: { from: '/sync', restoreKpId: 'kp-1' },
          },
        ]}
      >
        <Routes>
          <Route path="/train" element={<TrainPage />} />
          <Route path="/sync" element={<div>sync restored</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('混合提升')).toBeInTheDocument();
    expect(screen.getByTestId('runner-title')).toHaveAttribute('data-deferred', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'runner back' }));

    expect(await screen.findByText('sync restored')).toBeInTheDocument();
  });

  it('submits graded scope diagnostic answer ids to backend for the chapter decision', async () => {
    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));

    expect(await screen.findByText('单元检测')).toBeInTheDocument();
    expect(screen.getByTestId('runner-title')).toHaveAttribute('data-deferred', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));

    await waitFor(() => {
      expect(api.getSubmittedScopeDiagnosticFeedback).toHaveBeenCalledWith(
        'chapter',
        '运动的描述',
        [{ answer_id: 11, mastery_update: scopeDiagnosticAnswer.mastery_update }],
        'student-1',
      );
    });
    expect(await screen.findByText('后端定位反馈')).toBeInTheDocument();
  });

  it('keeps the latest scope diagnostic result reachable from the entry page', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(weakScopeResult);
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));

    expect(await screen.findByText('先回看坐标系，再做专项练。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始本步提升' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '回看知识' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '回看当前知识' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    expect(screen.getAllByText('运动的描述').length).toBeGreaterThan(0);
    expect(screen.getByText('正确 1/2')).toBeInTheDocument();
    expect(screen.getByText('发现 1 个薄弱点')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    expect(await screen.findByText('本章检测完成')).toBeInTheDocument();
    expect(screen.getByText('先回看坐标系，再做专项练。')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回' }));
    await userEvent.click(await screen.findByRole('button', { name: '继续薄弱点提升' }));

    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-weak', 5);
    });
  });

  it('starts weak-point improvement from the scope result primary action without losing the latest result', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(weakScopeResult);
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));

    await userEvent.click(await screen.findByRole('button', { name: '开始本步提升' }));

    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-weak', 5);
    });
    expect(await screen.findByTestId('runner-title')).toHaveTextContent('专项练');
    expect(screen.getByTestId('runner-title')).toHaveAttribute('data-deferred', 'false');
    await userEvent.click(await screen.findByRole('button', { name: 'runner back' }));
    expect(await screen.findByText('本章检测完成')).toBeInTheDocument();
    expect(screen.getByText('先回看坐标系，再做专项练。')).toBeInTheDocument();
  });

  it('uses the improvement plan current task before the scope-result fallback', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(planPriorityScopeResult);
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));

    expect(await screen.findByText('推荐下一步：先处理「低掌握」。')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(await screen.findByText('推荐先修复「低掌握」')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '继续薄弱点提升' }));

    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-primary', 5);
    });
  });

  it('creates a server improvement plan after scope diagnostic and uses the returned plan', async () => {
    const resultWithAttempt: ScopeDiagnosticResult = {
      ...planPriorityScopeResult,
      diagnostic_attempt_id: 'attempt-from-feedback',
    };
    const serverPlan = makeServerPlan(resultWithAttempt);
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(resultWithAttempt);
    vi.mocked(api.createImprovementPlanFromScopeResult).mockResolvedValue(serverPlan);
    vi.mocked(api.updateImprovementTaskStatus).mockResolvedValue(withServerTaskStatus(serverPlan, 'server-task-1', 'in_progress'));
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));

    await waitFor(() => {
      expect(api.createImprovementPlanFromScopeResult).toHaveBeenCalledWith(
        expect.objectContaining({ diagnostic_attempt_id: 'attempt-from-feedback' }),
        'student-1',
      );
    });
    expect(await screen.findByText('推荐下一步：先处理「后端推荐任务」。')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: '开始本步提升' }));
    expect(api.updateImprovementTaskStatus).toHaveBeenCalledWith('server-plan-1', 'server-task-1', 'in_progress', 'student-1');
    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-server', 5);
    });
  });

  it('shows the local improvement path immediately while server plan creation is pending', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(planPriorityScopeResult);
    vi.mocked(api.createImprovementPlanFromScopeResult).mockImplementation(() => new Promise(() => undefined));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));

    expect(await screen.findByText('提升路径', {}, { timeout: 500 })).toBeInTheDocument();
    expect(screen.getByText('推荐下一步：先处理「低掌握」。')).toBeInTheDocument();
    expect(api.createImprovementPlanFromScopeResult).toHaveBeenCalledWith(planPriorityScopeResult, 'student-1');
  });

  it('maps an active local task to the server task when plan creation resolves late', async () => {
    const baseServerPlan = makeServerPlan(planPriorityScopeResult as ScopeDiagnosticResult);
    const serverPlan: ImprovementPlan = {
      ...baseServerPlan,
      currentTaskId: 'server-task-1',
      tasks: [
        {
          ...baseServerPlan.tasks[0],
          kpId: 'kp-primary',
          kpName: '低掌握',
        },
        {
          ...baseServerPlan.tasks[1],
          kpId: 'kp-secondary',
          kpName: '先出现在薄弱列表',
        },
      ],
    };
    let resolveServerPlan: (plan: ImprovementPlan) => void = () => undefined;
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(planPriorityScopeResult);
    vi.mocked(api.createImprovementPlanFromScopeResult).mockImplementation(() => new Promise((resolve) => {
      resolveServerPlan = resolve;
    }));
    vi.mocked(api.updateImprovementTaskStatus).mockImplementation(async (_planId, taskId, status) => {
      if (taskId !== 'server-task-1') {
        throw new Error(`unexpected task id ${taskId}`);
      }
      return withServerTaskStatus(serverPlan, taskId, status);
    });
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));

    expect(await screen.findByText('推荐下一步：先处理「低掌握」。')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: '开始本步提升' }));
    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-primary', 5);
    });

    await act(async () => {
      resolveServerPlan(serverPlan);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.updateImprovementTaskStatus).toHaveBeenCalledWith('server-plan-1', 'server-task-1', 'in_progress', 'student-1');
    });

    vi.mocked(api.updateImprovementTaskStatus).mockClear();
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '练习结果' }));

    await waitFor(() => {
      expect(api.updateImprovementTaskStatus).toHaveBeenCalledWith('server-plan-1', 'server-task-1', 'practiced', 'student-1');
    });
    expect(await screen.findByText(/本步提升已记录/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '回到提升路径' }));
    expect(await screen.findByText('修复「先出现在薄弱列表」')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: /掌握度/ }).length).toBeGreaterThan(0);
  });

  it('falls back to a local improvement plan when server plan creation fails', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(planPriorityScopeResult);
    vi.mocked(api.createImprovementPlanFromScopeResult).mockRejectedValue(new Error('server unavailable'));
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));

    expect(await screen.findByText('推荐下一步：先处理「低掌握」。')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: '开始本步提升' }));

    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-primary', 5);
    });
  });

  it('restores the latest server improvement plan on entry', async () => {
    const serverPlan = makeServerPlan(weakScopeResult as ScopeDiagnosticResult);
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(serverPlan);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    expect(screen.getByText('推荐先修复「后端推荐任务」')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));

    expect(await screen.findByText('提升路径')).toBeInTheDocument();
    expect(screen.getByText('推荐下一步：先处理「后端推荐任务」。')).toBeInTheDocument();
  });

  it('marks the current improvement task in progress after starting the step practice', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(planPriorityScopeResult);
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));
    await userEvent.click(await screen.findByRole('button', { name: '开始本步提升' }));

    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-primary', 5);
    });
    await userEvent.click(await screen.findByRole('button', { name: 'runner back' }));

    expect(await screen.findByText('本章检测完成')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '继续本步提升' })).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: /掌握度/ }).length).toBeGreaterThan(0);
  });

  it('records an improvement task as practiced and can return to the improvement path', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(planPriorityScopeResult);
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));
    await userEvent.click(await screen.findByRole('button', { name: '开始本步提升' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '练习结果' }));

    expect(await screen.findByText(/本步提升已记录/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回到提升路径' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续下一步' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '回到提升路径' }));
    expect(screen.queryByText('已练习')).not.toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: /掌握度/ }).length).toBeGreaterThan(0);
    expect(screen.getByText('修复「先出现在薄弱列表」')).toBeInTheDocument();
  });

  it('continues to the next improvement task from the improvement practice summary', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(planPriorityScopeResult);
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));
    await userEvent.click(await screen.findByRole('button', { name: '开始本步提升' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '练习结果' }));
    await userEvent.click(await screen.findByRole('button', { name: '继续下一步' }));

    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-secondary', 5);
    });
  });

  it('syncs practiced status and continues through the server next-task endpoint', async () => {
    const serverPlan = makeServerPlan(planPriorityScopeResult as ScopeDiagnosticResult);
    const inProgressPlan = withServerTaskStatus(serverPlan, 'server-task-1', 'in_progress');
    const practicedPlan: ImprovementPlan = {
      ...withServerTaskStatus(serverPlan, 'server-task-1', 'practiced', 'server-task-2'),
      status: 'in_progress',
    };
    const movedPlan: ImprovementPlan = {
      ...withServerTaskStatus(practicedPlan, 'server-task-2', 'in_progress', 'server-task-2'),
      currentTaskId: 'server-task-2',
    };
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(planPriorityScopeResult);
    vi.mocked(api.createImprovementPlanFromScopeResult).mockResolvedValue(serverPlan);
    vi.mocked(api.updateImprovementTaskStatus).mockImplementation(async (_planId, _taskId, status) => (
      status === 'in_progress' ? inProgressPlan : practicedPlan
    ));
    vi.mocked(api.moveToNextImprovementTaskOnServer).mockResolvedValue(movedPlan);
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));
    await userEvent.click(await screen.findByRole('button', { name: '开始本步提升' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '练习结果' }));

    await waitFor(() => {
      expect(api.updateImprovementTaskStatus).toHaveBeenCalledWith('server-plan-1', 'server-task-1', 'practiced', 'student-1');
    });
    vi.mocked(api.updateImprovementTaskStatus).mockClear();
    await userEvent.click(await screen.findByRole('button', { name: '继续下一步' }));

    expect(api.moveToNextImprovementTaskOnServer).toHaveBeenCalledWith('server-plan-1', 'student-1');
    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-server-next', 5);
    });
    expect(api.updateImprovementTaskStatus).not.toHaveBeenCalled();
  });

  it('falls back to local next-task movement when the server next endpoint fails', async () => {
    const serverPlan = makeServerPlan(planPriorityScopeResult as ScopeDiagnosticResult);
    const practicedPlan: ImprovementPlan = {
      ...withServerTaskStatus(serverPlan, 'server-task-1', 'practiced', 'server-task-2'),
      status: 'in_progress',
    };
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(planPriorityScopeResult);
    vi.mocked(api.createImprovementPlanFromScopeResult).mockResolvedValue(serverPlan);
    vi.mocked(api.updateImprovementTaskStatus).mockImplementation(async (_planId, _taskId, status) => (
      status === 'practiced' ? practicedPlan : serverPlan
    ));
    vi.mocked(api.moveToNextImprovementTaskOnServer).mockRejectedValue(new Error('next failed'));
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));
    await userEvent.click(await screen.findByRole('button', { name: '开始本步提升' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '练习结果' }));
    await waitFor(() => {
      expect(api.updateImprovementTaskStatus).toHaveBeenCalledWith('server-plan-1', 'server-task-1', 'practiced', 'student-1');
    });
    await userEvent.click(await screen.findByRole('button', { name: '继续下一步' }));

    expect(api.moveToNextImprovementTaskOnServer).toHaveBeenCalledWith('server-plan-1', 'student-1');
    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-server-next', 5);
    });
  });

  it('keeps the local improvement flow when server task status update fails', async () => {
    const serverPlan = makeServerPlan(planPriorityScopeResult as ScopeDiagnosticResult);
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(planPriorityScopeResult);
    vi.mocked(api.createImprovementPlanFromScopeResult).mockResolvedValue(serverPlan);
    vi.mocked(api.updateImprovementTaskStatus).mockRejectedValue(new Error('status update failed'));
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));
    await userEvent.click(await screen.findByRole('button', { name: '开始本步提升' }));

    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-server', 5);
    });
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '练习结果' }));

    expect(await screen.findByText(/本步提升已记录/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回到提升路径' })).toBeInTheDocument();
  });

  it('does not show improvement summary actions for ordinary practice', async () => {
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train?kp=kp-1']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('混合提升')).toBeInTheDocument();
    expect(screen.getByTestId('runner-title')).toHaveAttribute('data-deferred', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'mock grade scope q-1' }));

    expect(await screen.findByRole('dialog', { name: '练习结果' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '回到提升路径' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '继续下一步' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '换方向继续练' })).toBeInTheDocument();
  });

  it('continues from the lowest mastery result when the latest diagnostic has no weak ids', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue({
      ...weakScopeResult,
      kp_results: [
        { ...weakScopeResult.kp_results[0], kp_id: 'kp-stable', kp_name: '质点', mastery_after: 0.82 },
        { ...weakScopeResult.kp_results[1], kp_id: 'kp-low', kp_name: '坐标系', mastery_after: 0.64 },
      ],
      weak_kp_ids: [],
      recommendation: 'practice',
    });
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));

    expect(await screen.findByRole('button', { name: '开始本步提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回' }));
    await userEvent.click(await screen.findByRole('button', { name: '继续提升' }));

    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-low', 5);
    });
  });

  it('starts improvement from the scope result primary action using the lowest mastery kp when no weak ids exist', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue({
      ...weakScopeResult,
      kp_results: [
        { ...weakScopeResult.kp_results[0], kp_id: 'kp-stable', kp_name: '质点', mastery_after: 0.82 },
        { ...weakScopeResult.kp_results[1], kp_id: 'kp-low', kp_name: '坐标系', mastery_after: 0.64 },
      ],
      weak_kp_ids: [],
      recommendation: 'practice',
    });
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));
    await userEvent.click(await screen.findByRole('button', { name: '开始本步提升' }));

    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-low', 5);
    });
  });

  it('starts a stage retest from a ready improvement plan instead of showing the placeholder', async () => {
    const readyPlan = makeReadyForRetestPlan();
    const completedResult = makeRetestResult(readyPlan, true);
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(readyPlan);
    vi.mocked(api.startImprovementRetest).mockResolvedValue({
      attemptId: 'attempt-1',
      plan: readyPlan,
      session: retestSession,
    });
    vi.mocked(api.submitImprovementRetestFeedback).mockResolvedValue(completedResult);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));

    const retestButtons = await screen.findAllByRole('button', { name: '开始阶段复测' });
    expect(retestButtons.length).toBeGreaterThan(0);
    expect(screen.queryByText('阶段复测即将开放')).not.toBeInTheDocument();
    await userEvent.click(retestButtons[0]);

    await waitFor(() => {
      expect(api.startImprovementRetest).toHaveBeenCalledWith('server-plan-1', undefined, 'student-1');
    });
    expect(await screen.findByText('阶段复测')).toBeInTheDocument();
    expect(screen.getByTestId('runner-title')).toHaveAttribute('data-deferred', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '复测结果' })));

    await waitFor(() => {
      expect(api.submitImprovementRetestFeedback).toHaveBeenCalledWith(
        'server-plan-1',
        'attempt-1',
        [{ answer_id: 11, mastery_update: scopeDiagnosticAnswer.mastery_update }],
        'student-1',
      );
    });
    expect(await screen.findByText('阶段复测完成')).toBeInTheDocument();
    expect(screen.getByText('本轮提升已通过')).toBeInTheDocument();
  });

  it('shows retest result judgments without overriding a passed retest result', async () => {
    const readyPlan = makeReadyForRetestPlan();
    const completedResult = makeRetestResult(readyPlan, true);
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(readyPlan);
    vi.mocked(api.startImprovementRetest).mockResolvedValue({
      attemptId: 'attempt-1',
      plan: readyPlan,
      session: retestSession,
    });
    vi.mocked(api.submitImprovementRetestFeedback).mockResolvedValue(completedResult);
    vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({
      items: [
        makeJudgment({
          kpId: 'kp-server',
          masteryLevel: 'weak',
          interventionStatus: 'needs_retest',
          nextAction: 'retest',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    await userEvent.click((await screen.findAllByRole('button', { name: '开始阶段复测' }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '复测结果' }));

    expect(await screen.findByText('阶段复测完成')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.getKnowledgeMasteryJudgments).toHaveBeenCalledWith(['kp-server'], 'student-1');
    });
    expect(await screen.findByLabelText('统一判断：近期已通过')).toBeInTheDocument();
    expect(screen.queryByLabelText('统一判断：待复测')).not.toBeInTheDocument();
    expect(screen.queryByText('needs_retest')).not.toBeInTheDocument();
  });

  it('keeps a failed retest result stronger than a passed-recently judgment', async () => {
    const readyPlan = makeReadyForRetestPlan();
    const failedResult = makeRetestResult(readyPlan, false);
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(readyPlan);
    vi.mocked(api.startImprovementRetest).mockResolvedValue({
      attemptId: 'attempt-1',
      plan: readyPlan,
      session: retestSession,
    });
    vi.mocked(api.submitImprovementRetestFeedback).mockResolvedValue(failedResult);
    vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({
      items: [
        makeJudgment({
          kpId: 'kp-server',
          masteryLevel: 'mastered',
          interventionStatus: 'passed_recently',
          nextAction: 'maintain',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    await userEvent.click((await screen.findAllByRole('button', { name: '开始阶段复测' }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '复测结果' }));

    expect(await screen.findByText('阶段复测完成')).toBeInTheDocument();
    expect(screen.getByText('还有知识点需要继续补弱')).toBeInTheDocument();
    expect(await screen.findByLabelText('统一判断：仍需巩固')).toBeInTheDocument();
    expect(screen.queryByLabelText('统一判断：近期已通过')).not.toBeInTheDocument();
  });

  it('opens the improvement report after a completed stage retest', async () => {
    const readyPlan = makeReadyForRetestPlan();
    const completedResult = makeRetestResult(readyPlan, true);
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(readyPlan);
    vi.mocked(api.startImprovementRetest).mockResolvedValue({
      attemptId: 'attempt-1',
      plan: readyPlan,
      session: retestSession,
    });
    vi.mocked(api.submitImprovementRetestFeedback).mockResolvedValue(completedResult);
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport(completedResult.plan));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    await userEvent.click((await screen.findAllByRole('button', { name: '开始阶段复测' }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '复测结果' }));

    await userEvent.click(await screen.findByRole('button', { name: '查看提升报告' }));

    await waitFor(() => {
      expect((api as any).getImprovementReport).toHaveBeenCalledWith('server-plan-1', 'student-1');
    });
    expect(await screen.findByText('提升报告')).toBeInTheDocument();
    expect(screen.getByText('「运动的描述」本轮提升已完成')).toBeInTheDocument();
    expect(screen.getByText('检测正确率')).toBeInTheDocument();
    expect(screen.getByText('复测记录')).toBeInTheDocument();
    expect(screen.getByText('下一步建议')).toBeInTheDocument();
  });

  it('keeps the retest result page visible when opening the report fails', async () => {
    const readyPlan = makeReadyForRetestPlan();
    const completedResult = makeRetestResult(readyPlan, true);
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(readyPlan);
    vi.mocked(api.startImprovementRetest).mockResolvedValue({
      attemptId: 'attempt-1',
      plan: readyPlan,
      session: retestSession,
    });
    vi.mocked(api.submitImprovementRetestFeedback).mockResolvedValue(completedResult);
    vi.mocked((api as any).getImprovementReport).mockRejectedValue(new Error('report offline'));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    await userEvent.click((await screen.findAllByRole('button', { name: '开始阶段复测' }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '复测结果' }));
    await userEvent.click(await screen.findByRole('button', { name: '查看提升报告' }));

    expect(await screen.findByText('提升报告加载失败：report offline')).toBeInTheDocument();
    expect(screen.getByText('阶段复测完成')).toBeInTheDocument();
  });

  it('keeps a completed improvement plan read-only without task practice actions', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(completedPlan);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));

    expect((await screen.findAllByText('本轮提升已通过')).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: '专项练' })).toHaveLength(0);
    const passedButtons = await screen.findAllByRole('button', { name: '已通过' });
    expect(passedButtons.length).toBeGreaterThan(0);
    passedButtons.forEach(button => expect(button).toBeDisabled());
    const reportButtons = await screen.findAllByRole('button', { name: '查看提升报告' });
    expect(reportButtons.length).toBeGreaterThan(0);
    reportButtons.forEach(button => expect(button).not.toBeDisabled());
  });

  it('opens the improvement report from a completed scope result panel without reopening practice', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(completedPlan);
    vi.mocked((api as any).getImprovementReport).mockResolvedValue(makeImprovementReport(completedPlan));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    const reportButtons = await screen.findAllByRole('button', { name: '查看提升报告' });
    await userEvent.click(reportButtons[0]);

    expect(await screen.findByText('提升报告')).toBeInTheDocument();
    expect(api.getPracticeSession).not.toHaveBeenCalled();
    expect(api.updateImprovementTaskStatus).not.toHaveBeenCalled();
  });

  it('shows an error if the improvement report cannot be loaded and keeps the current page', async () => {
    const completedPlan = makeRetestResult(makeReadyForRetestPlan(), true).plan;
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(completedPlan);
    vi.mocked((api as any).getImprovementReport).mockRejectedValue(new Error('report offline'));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    const reportButtons = await screen.findAllByRole('button', { name: '查看提升报告' });
    await userEvent.click(reportButtons[0]);

    expect(await screen.findByText('提升报告加载失败：report offline')).toBeInTheDocument();
    expect(screen.getByText('提升路径')).toBeInTheDocument();
  });

  it('does not start practice from a passed task row', async () => {
    const basePlan = makeServerPlan(weakScopeResult as ScopeDiagnosticResult);
    const planWithPassedTask: ImprovementPlan = {
      ...basePlan,
      status: 'in_progress',
      currentTaskId: 'server-task-2',
      tasks: basePlan.tasks.map((task, index) => (
        index === 0 ? { ...task, status: 'passed' } : task
      )),
    };
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(planWithPassedTask);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));

    const passedButton = await screen.findByRole('button', { name: '已通过' });
    expect(passedButton).toBeDisabled();
    await userEvent.click(passedButton);
    expect(api.getPracticeSession).not.toHaveBeenCalled();
    expect(api.updateImprovementTaskStatus).not.toHaveBeenCalled();
  });

  it('keeps practiced tasks waiting for stage retest instead of offering task practice', async () => {
    const readyPlan = makeReadyForRetestPlan();
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(readyPlan);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));

    expect(await screen.findByText('本轮提升任务已完成，可以进入阶段复测。')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '开始阶段复测' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: '专项练' })).toHaveLength(0);
    const waitingButtons = await screen.findAllByRole('button', { name: '待复测' });
    expect(waitingButtons.length).toBeGreaterThan(0);
    waitingButtons.forEach(button => expect(button).toBeDisabled());
  });

  it('keeps failed retest tasks actionable and continues weak-point practice', async () => {
    const readyPlan = makeReadyForRetestPlan();
    const failedResult = makeRetestResult(readyPlan, false);
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(readyPlan);
    vi.mocked(api.startImprovementRetest).mockResolvedValue({
      attemptId: 'attempt-1',
      plan: readyPlan,
      session: retestSession,
    });
    vi.mocked(api.submitImprovementRetestFeedback).mockResolvedValue(failedResult);
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    await userEvent.click((await screen.findAllByRole('button', { name: '开始阶段复测' }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '复测结果' }));

    expect((await screen.findAllByText((_, element) => (
      element?.textContent?.includes('仍需补弱 1 项') ?? false
    ))).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: '继续补弱' }));

    await waitFor(() => {
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-server', 5);
    });
  });

  it('keeps needs-retest task rows actionable for another weak-point practice', async () => {
    const basePlan = makeServerPlan(weakScopeResult as ScopeDiagnosticResult);
    const needsRetestPlan: ImprovementPlan = {
      ...basePlan,
      status: 'in_progress',
      currentTaskId: 'server-task-1',
      tasks: basePlan.tasks.map((task, index) => (
        index === 0 ? { ...task, status: 'needs_retest' } : task
      )),
    };
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(needsRetestPlan);
    vi.mocked(api.updateImprovementTaskStatus).mockResolvedValue(
      withServerTaskStatus(needsRetestPlan, 'server-task-1', 'in_progress'),
    );
    vi.mocked(api.getPracticeSession).mockResolvedValue(practiceSession);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    await userEvent.click((await screen.findAllByRole('button', { name: '专项练' }))[0]);

    await waitFor(() => {
      expect(api.updateImprovementTaskStatus).toHaveBeenCalledWith('server-plan-1', 'server-task-1', 'in_progress', 'student-1');
      expect(api.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-server', 5);
    });
    expect(await screen.findByTestId('runner-title')).toHaveTextContent('专项练');
    expect(screen.getByTestId('runner-title')).toHaveAttribute('data-deferred', 'false');
    await userEvent.click(await screen.findByRole('button', { name: 'runner back' }));
    expect(await screen.findByText('本章检测完成')).toBeInTheDocument();
  });

  it('shows an error when starting a stage retest fails and keeps the improvement path visible', async () => {
    const readyPlan = makeReadyForRetestPlan();
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(readyPlan);
    vi.mocked(api.startImprovementRetest).mockRejectedValue(new Error('No questions available for retest'));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    await userEvent.click((await screen.findAllByRole('button', { name: '开始阶段复测' }))[0]);

    expect(await screen.findByText('阶段复测启动失败：当前范围暂无可用于复测的题目，请先继续专项练习或更换范围。')).toBeInTheDocument();
    expect(screen.getByText('提升路径')).toBeInTheDocument();
  });

  it('shows a friendly message when no tasks are ready for retest', async () => {
    const readyPlan = makeReadyForRetestPlan();
    vi.mocked(api.getLatestImprovementPlan).mockResolvedValue(readyPlan);
    vi.mocked(api.startImprovementRetest).mockRejectedValue(new Error('No tasks ready for retest'));

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看检测结果' }));
    await userEvent.click((await screen.findAllByRole('button', { name: '开始阶段复测' }))[0]);

    expect(await screen.findByText('阶段复测启动失败：当前没有待复测任务，请先完成提升路径中的任务。')).toBeInTheDocument();
  });

  it('disables improvement actions when the latest diagnostic has no candidate knowledge point', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(emptyScopeResult);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));

    expect((await screen.findAllByRole('button', { name: '暂无可提升任务' }))[0]).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(await screen.findByRole('button', { name: '暂无可提升知识点' })).toBeDisabled();
  });

  it('clears the previous scope result only when restarting the diagnostic', async () => {
    vi.mocked(api.getSubmittedScopeDiagnosticFeedback).mockResolvedValue(weakScopeResult);

    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));
    await userEvent.click(await screen.findByRole('button', { name: 'mock grade scope q-1' }));
    await userEvent.click((await screen.findByRole('button', { name: '检测结果' })));
    await userEvent.click(await screen.findByRole('button', { name: '返回' }));

    expect(await screen.findByText('最近检测结果')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重新检测' }));

    await waitFor(() => {
      expect(api.scopeDiagnose).toHaveBeenCalledTimes(2);
    });
    await userEvent.click(await screen.findByRole('button', { name: 'runner back' }));
    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    expect(screen.queryByText('最近检测结果')).not.toBeInTheDocument();
  });

  it('uses shared question workspace button classes for session final actions', async () => {
    render(
      <MemoryRouter initialEntries={['/train']}>
        <TrainPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固提升' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }));

    expect(await screen.findByText('单元检测')).toBeInTheDocument();
    expect(screen.getByTestId('runner-title')).toHaveAttribute('data-deferred', 'true');
    const submitButton = screen.getByRole('button', { name: '正在生成检测结果...' });

    expect(submitButton).toHaveClass('question-workspace-nav-button');
    expect(submitButton).toHaveClass('question-workspace-nav-button-primary');
    expect(submitButton).toHaveClass('question-workspace-header-submit');
    expect(submitButton).toHaveClass('is-disabled');
  });
});
