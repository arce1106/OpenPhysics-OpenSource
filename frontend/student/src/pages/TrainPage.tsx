import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { getStudentId, getStudentProfile } from '../api/studentIdentity';
import QuestionSessionRunner from '../components/QuestionSessionRunner';
import SessionResultDialog from '../components/SessionResultDialog';
import AccountAccessPanel from '../components/AccountAccessPanel';
import { TrainDiagnosticAttemptDetailPanel, TrainDiagnosticHistoryPanel, TrainHeader, TrainImprovementReportHistoryPanel, TrainImprovementReportPanel, TrainLearningTracePanel, TrainRetestResultPanel, TrainScopeResultPanel } from '../components/train';
import { ChapterList, LearningWorkspace } from '../components/learningPath';
import { learningStateFor } from '../components/learningPath/learningKpStatus';
import { buildPracticeSummary } from '../utils/practiceSummary';
import { buildSubmittedDiagnosticAnswers } from '../utils/submittedDiagnosticAnswers';
import {
  buildImprovementPlan,
  getCurrentImprovementTask,
  getNextActionableImprovementTask,
  getTaskById,
  moveToNextImprovementTask,
  pickNextKpFromImprovementPlan,
  updateImprovementTaskStatus,
} from '../utils/improvementPlan';
import { pickNextKpFromScopeResult } from '../utils/trainScope';
import { getReturnState, navigateBackToPreviousPage } from '../utils/navigation';
import { canEnterLearningArea, hasLearningAccess, isLearningAccessError } from '../utils/learningAccess';
import {
  getTrainJudgmentActionHint,
  getTrainJudgmentSummaryText,
  summarizeKnowledgeMasteryJudgments,
  type TrainJudgmentSummary,
} from '../utils/knowledgeMasteryJudgment';
import { useQuestionSessionState } from '../hooks/useQuestionSessionState';
import {loadPracticeRecord} from '../utils/practicePersistence';
import type { DirectoryData, DirectoryKpNode, ImprovementPlan, ImprovementReport, ImprovementReportListItem, ImprovementRetestResult, KnowledgeMasteryJudgment, LearningTraceEvent, RecommendedKp, ScopeDiagnosticAttemptDetail, ScopeDiagnosticAttemptListItem, ScopeDiagnosticResult, TrainStartData, PracticeSession } from '../types';

const STRATEGY_LABELS: Record<string, string> = {
  exploration: '探索模式',
  diagnostic_baseline: '单元检测',
  focus_on_basics: '基础强化',
  foundation_building: '构建基础',
  balanced_practice: '平衡训练',
  reinforcement: '巩固提升',
  comprehensive_review: '综合复习',
};

type Phase =
  | 'entry'
  | 'session'
  | 'scope_complete'
  | 'retest_complete'
  | 'report'
  | 'report_history'
  | 'diagnostic_history'
  | 'diagnostic_attempt'
  | 'learning_trace';
type PracticeSessionReturnTarget = 'entry' | 'scope_complete';

interface PracticeSessionContext {
  title: string;
  returnTarget: PracticeSessionReturnTarget;
}

interface ChapterSummary {
  key: string;
  volume: string;
  chapter: string;
  order: number;
  total: number;
  mastered: number;
  masterySum: number;
  avgMastery: number;
  latestLastPracticed: string | null;
  kps: DirectoryKpNode[];
  weakKps: RecommendedKp[];
  status: string;
}

interface VolumeSummary {
  key: string;
  name: string;
  order: number;
  total: number;
  mastered: number;
  weakCount: number;
  chapterCount: number;
  masterySum: number;
  avgMastery: number;
}

type TrainJudgmentRequest =
  | { type: 'kps'; kpIds: string[] }
  | { type: 'scope'; scopeType: 'chapter' | 'section'; scopeId: string };

interface ScopeDiagnosticContext {
  scopeType: 'chapter' | 'section';
  scopeId: string;
  scopeName: string;
}

function isPersistedImprovementPlan(plan: ImprovementPlan): boolean {
  return !plan.id.includes(':');
}

function scopeResultFromImprovementPlan(plan: ImprovementPlan): ScopeDiagnosticResult {
  if (plan.sourceResult) return plan.sourceResult;
  return {
    diagnostic_attempt_id: plan.diagnosticAttemptId ?? null,
    scope_type: plan.scopeType,
    scope_id: plan.scopeId,
    scope_name: plan.scopeName,
    kp_results: plan.tasks.map(task => ({
      kp_id: task.kpId,
      kp_name: task.kpName,
      correct_count: task.correctCount,
      total_count: task.totalCount,
      mastery_before: task.masteryBefore,
      mastery_after: task.masteryAfter,
    })),
    correct_count: plan.correctCount,
    total_count: plan.totalCount,
    weak_kp_ids: plan.tasks.filter(task => task.isWeak).map(task => task.kpId),
    recommendation: plan.weakCount > 0 ? 'study' : 'practice',
    feedback: plan.weakCount > 0
      ? '已经恢复最近检测结果，建议继续完成薄弱点提升。'
      : '已经恢复最近检测结果，可以继续做一组提升训练。',
  };
}

function resolveActiveTask(
  plan: ImprovementPlan,
  activeTaskId?: string | null,
  activeTaskKpId?: string | null,
): ImprovementPlan['tasks'][number] | null {
  if (activeTaskId) {
    const byId = getTaskById(plan, activeTaskId);
    if (byId) return byId;
  }
  if (activeTaskKpId) {
    return plan.tasks.find(task => task.kpId === activeTaskKpId) || null;
  }
  return null;
}

const VOLUME_ORDER = [
  '必修 第一册',
  '必修 第二册',
  '必修 第三册',
  '选择性必修 第一册',
  '选择性必修 第二册',
  '选择性必修 第三册',
];

const SHORT_VOLUME_LABELS: Record<string, string> = {
  '必修 第一册': '必修一',
  '必修 第二册': '必修二',
  '必修 第三册': '必修三',
  '选择性必修 第一册': '选必一',
  '选择性必修 第二册': '选必二',
  '选择性必修 第三册': '选必三',
};

function newerIsoDate(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}

function volumeOrder(volume: string): number {
  const index = VOLUME_ORDER.indexOf(volume);
  return index >= 0 ? index : VOLUME_ORDER.length;
}

function shortVolumeLabel(volume: string): string {
  return SHORT_VOLUME_LABELS[volume] || volume;
}

function getChapterStatus(chapter: Pick<ChapterSummary, 'avgMastery' | 'mastered' | 'total' | 'weakKps'>): string {
  if (chapter.weakKps.length > 0) return '有薄弱';
  if (chapter.total === 0 || chapter.avgMastery === 0) return '未开始';
  if (chapter.avgMastery < 0.4) return '待检测';
  if (chapter.avgMastery < 0.7) return '可提升';
  if (chapter.mastered >= chapter.total) return '已稳定';
  return '可提升';
}

function statusColor(status: string): string {
  if (status === '已稳定') return '#52c41a';
  if (status === '可提升') return '#14919b';
  if (status === '有薄弱') return '#ff7a45';
  if (status === '待检测') return '#faad14';
  return '#9aa4b2';
}

function buildChapterSummaries(
  dirData: DirectoryData | null,
  recommendedKps: RecommendedKp[] = [],
): ChapterSummary[] {
  if (!dirData) return [];
  const kpMap = new Map(dirData.kps.map(kp => [kp.id, kp]));
  const recommendedByChapter = new Map<string, RecommendedKp[]>();
  recommendedKps.forEach(kp => {
    const node = kpMap.get(kp.kp_id);
    if (!node?.chapter) return;
    const volume = node.volume || '默认';
    const key = `${volume}||${node.chapter}`;
    recommendedByChapter.set(key, [...(recommendedByChapter.get(key) || []), kp]);
  });

  const chapterMap = new Map<string, Omit<ChapterSummary, 'avgMastery' | 'status' | 'weakKps'>>();
  dirData.kps.forEach((kp, index) => {
    if (!kp.chapter) return;
    const volume = kp.volume || '默认';
    const key = `${volume}||${kp.chapter}`;
    const current = chapterMap.get(key) || {
      key,
      volume,
      chapter: kp.chapter,
      order: index,
      total: 0,
      mastered: 0,
      masterySum: 0,
      latestLastPracticed: null,
      kps: [],
    };
    current.total += 1;
    current.masterySum += kp.mastery;
    current.latestLastPracticed = newerIsoDate(current.latestLastPracticed, kp.last_practiced);
    current.kps.push(kp);
    if (learningStateFor(kp) === 'mastered') current.mastered += 1;
    chapterMap.set(key, current);
  });

  return Array.from(chapterMap.values())
    .sort((a, b) => {
      const volumeCompare = volumeOrder(a.volume) - volumeOrder(b.volume);
      if (volumeCompare !== 0) return volumeCompare;
      return a.order - b.order;
    })
    .map(chapter => {
      const avgMastery = chapter.total > 0 ? chapter.masterySum / chapter.total : 0;
      const weakKps = recommendedByChapter.get(chapter.key) || [];
      const summary = { ...chapter, avgMastery, weakKps };
      return { ...summary, status: getChapterStatus(summary) };
    });
}

function buildVolumeSummaries(chapters: ChapterSummary[]): VolumeSummary[] {
  const volumeMap = new Map<string, Omit<VolumeSummary, 'avgMastery'>>();
  chapters.forEach(chapter => {
    const current = volumeMap.get(chapter.volume) || {
      key: chapter.volume,
      name: chapter.volume,
      order: volumeOrder(chapter.volume),
      total: 0,
      mastered: 0,
      weakCount: 0,
      chapterCount: 0,
      masterySum: 0,
    };
    current.total += chapter.total;
    current.mastered += chapter.mastered;
    current.weakCount += chapter.weakKps.length;
    current.chapterCount += 1;
    current.masterySum += chapter.masterySum;
    volumeMap.set(chapter.volume, current);
  });

  return Array.from(volumeMap.values())
    .sort((a, b) => a.order - b.order)
    .map(volume => ({
      ...volume,
      avgMastery: volume.total > 0 ? volume.masterySum / volume.total : 0,
    }));
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

function mapJudgmentsByKpId(items: KnowledgeMasteryJudgment[] = []): Record<string, KnowledgeMasteryJudgment> {
  return items.reduce<Record<string, KnowledgeMasteryJudgment>>((acc, item) => {
    if (item.kpId) acc[item.kpId] = item;
    return acc;
  }, {});
}

function ChapterRoutePanel({
  chapter,
  targetScopeType,
  targetScopeId,
  targetScopeName,
  sessionLoading,
  onStartScopeDiagnostic,
  onViewDiagnosticHistory,
}: {
  chapter: ChapterSummary | null;
  targetScopeType?: 'chapter' | 'section';
  targetScopeId?: string;
  targetScopeName?: string;
  sessionLoading: boolean;
  onStartScopeDiagnostic: (scopeType: 'chapter' | 'section', scopeId: string) => void;
  onViewDiagnosticHistory: () => void;
}) {
  if (!chapter) {
    return (
      <div className="card train-empty-state" style={{ color: '#999', fontSize: 13 }}>
        暂无可提升章节
      </div>
    );
  }

  const currentScopeBelongsHere = !!targetScopeId && (
    (targetScopeType === 'chapter' && targetScopeId === chapter.chapter)
    || (targetScopeType === 'section' && targetScopeId.split('||')[0] === chapter.chapter)
  );
  const routeStatusStyle = {
    color: statusColor(chapter.status),
    borderColor: `${statusColor(chapter.status)}33`,
  };

  return (
    <div className="card train-route-card">
      <div className="train-route-header">
        <div>
          <div className="train-route-eyebrow">当前章节训练路径</div>
          <div className="train-route-current-label">{shortVolumeLabel(chapter.volume)} · {chapter.chapter}</div>
          <div className="train-route-title">{chapter.chapter}</div>
        </div>
        <span className="train-route-status" style={routeStatusStyle}>
          {chapter.status}
        </span>
      </div>

      <div className="train-route-stats" aria-label="章节训练统计">
        {[
          ['知识点', chapter.total],
          ['已掌握', chapter.mastered],
          ['薄弱点', chapter.weakKps.length],
          ['平均掌握', `${Math.round(chapter.avgMastery * 100)}%`],
        ].map(([label, value]) => (
          <div key={label} className="train-route-stat">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="train-route-steps">
        {currentScopeBelongsHere && targetScopeType && targetScopeId && (
          <div className="train-route-selected-scope">
            <div>
              <div className="train-route-selected-label">已选检测范围</div>
              <div className="train-route-selected-name">{targetScopeName}</div>
            </div>
            <button
              onClick={() => onStartScopeDiagnostic(targetScopeType, targetScopeId)}
              disabled={sessionLoading}
              className="train-route-primary-button"
            >
              开始检测
            </button>
          </div>
        )}

        <div className="train-route-step-action">
          <div>
            <div className="train-route-step-title">单元检测</div>
            <div className="train-route-step-text">
              先用少量题判断本章哪些知识点还不稳。
            </div>
          </div>
          <button
            onClick={() => {
              onStartScopeDiagnostic('chapter', chapter.chapter);
            }}
            disabled={sessionLoading}
            className="train-route-primary-button"
          >
            开始检测
          </button>
        </div>


        <div className="train-route-history-entry">
          <div>
            <div className="train-route-step-title">检测历史</div>
            <div className="train-route-step-text">
              查看本章以往检测结果和对应薄弱点。
            </div>
          </div>
          <button type="button" onClick={onViewDiagnosticHistory} className="train-route-secondary-button">
            查看检测历史
          </button>
        </div>

      </div>
    </div>
  );
}

function RecentScopeDiagnosticCard({
  result,
  plan,
  sessionLoading,
  onView,
  onContinue,
  onRediagnose,
}: {
  result: ScopeDiagnosticResult;
  plan?: ImprovementPlan | null;
  sessionLoading: boolean;
  onView: () => void;
  onContinue: (kpId: string) => void | Promise<void>;
  onRediagnose: () => void;
}) {
  const nextKpId = plan ? pickNextKpFromImprovementPlan(plan) : pickNextKpFromScopeResult(result);
  const currentTask = plan ? getCurrentImprovementTask(plan) : null;
  const scopeName = plan?.scopeName || result.scope_name;
  const correctCount = plan?.correctCount ?? result.correct_count;
  const totalCount = plan?.totalCount ?? result.total_count;
  const weakCount = plan?.weakCount ?? result.weak_kp_ids.length;
  const continueLabel = !nextKpId
    ? '暂无可提升知识点'
    : weakCount > 0
      ? '继续薄弱点提升'
      : '继续提升';

  return (
    <div className="card train-recent-scope-card">
      <div className="train-recent-scope-copy">
        <div className="train-route-eyebrow">最近检测结果</div>
        <div className="train-recent-scope-title">「{scopeName}」检测完成</div>
        <div className="train-recent-scope-meta">
          <span>正确 {correctCount}/{totalCount}</span>
          <span>发现 {weakCount} 个薄弱点</span>
        </div>
        {currentTask && (
          <div className="train-recent-scope-next">
            推荐先修复「{currentTask.kpName}」
          </div>
        )}
      </div>
      <div className="train-recent-scope-actions">
        <button type="button" onClick={onView} className="train-route-secondary-button">
          查看检测结果
        </button>
        <button
          type="button"
          onClick={() => {
            if (nextKpId) void onContinue(nextKpId);
          }}
          disabled={sessionLoading || !nextKpId}
          className="train-route-primary-button"
        >
          {continueLabel}
        </button>
        <button
          type="button"
          onClick={onRediagnose}
          disabled={sessionLoading}
          className="train-route-secondary-button"
        >
          重新检测
        </button>
      </div>
    </div>
  );
}

function formatPercent(value?: number | null): string {
  if (value === null || value === undefined) return '未完成';
  return `${Math.round(value * 100)}%`;
}

function buildReportShareText(report: ImprovementReport): string {
  const { summary } = report;
  const latestAttempt = report.retestAttempts[0];
  const retestLabel = latestAttempt
    ? `${latestAttempt.correctCount}/${latestAttempt.totalCount}`
    : formatPercent(summary.latestRetestAccuracy);
  const conclusion = summary.completed ? '本轮提升已完成' : '本轮提升仍在进行';
  const nextAction = report.nextActions[0]
    || '可以回到巩固提升首页选择新的章节或单元继续检测。';

  return [
    'OpenPhysics 提升报告',
    `范围：${summary.scopeName}`,
    `检测：${summary.diagnosticCorrectCount}/${summary.diagnosticTotalCount}`,
    `提升任务：已通过 ${summary.passedTaskCount}/${summary.taskCount}`,
    `阶段复测：${retestLabel}`,
    `结论：${conclusion}`,
    `下一步：${nextAction}`,
  ].join('\n');
}

function normalizeImprovementErrorMessage(message: string): string {
  if (message.includes('No questions available for retest')) {
    return '当前范围暂无可用于复测的题目，请先继续专项练习或更换范围。';
  }
  if (message.includes('No tasks ready for retest')) {
    return '当前没有待复测任务，请先完成提升路径中的任务。';
  }
  return message;
}

function RecentCompletedReportCard({
  report,
  onView,
  onHistory,
}: {
  report: ImprovementReport;
  onView: () => void;
  onHistory: () => void;
}) {
  const { summary } = report;
  return (
    <div className="card train-recent-scope-card">
      <div className="train-recent-scope-copy">
        <div className="train-route-eyebrow">最近提升报告</div>
        <div className="train-recent-scope-title">「{summary.scopeName}」提升闭环已完成</div>
        <div className="train-recent-scope-meta">
          <span>已通过 {summary.passedTaskCount}/{summary.taskCount}</span>
          <span>复测正确率 {formatPercent(summary.latestRetestAccuracy)}</span>
        </div>
        <div className="train-recent-scope-next">
          可以查看报告，复盘这轮补弱是否稳定。
        </div>
      </div>
      <div className="train-recent-scope-actions">
        <button type="button" onClick={onView} className="train-route-primary-button">
          查看报告
        </button>
        <button type="button" onClick={onHistory} className="train-route-secondary-button">
          查看历史报告
        </button>
      </div>
    </div>
  );
}

function TrainJudgmentSummaryCard({
  summary,
}: {
  summary: TrainJudgmentSummary;
}) {
  const summaryText = getTrainJudgmentSummaryText(summary);
  const actionHint = getTrainJudgmentActionHint(summary, 'entry');
  const retestCount = summary.awaitingRetestCount + summary.needsRetestCount;
  const needsWorkCount = summary.weakCount + summary.developingCount;
  const stableCount = summary.stableCount + summary.masteredCount;
  const chips = [
    { label: '提升中', count: summary.inImprovementCount, tone: 'practice' },
    { label: '待复测', count: retestCount, tone: 'retest' },
    { label: '薄弱', count: summary.weakCount, tone: 'weak' },
    { label: '发展中', count: summary.developingCount, tone: 'developing' },
    { label: '近期通过', count: summary.passedRecentlyCount, tone: 'passed' },
    { label: '证据较少', count: summary.lowConfidenceCount, tone: 'low' },
    {
      label: '较稳定',
      count: stableCount,
      tone: 'stable',
      hidden: needsWorkCount > 0 || summary.inImprovementCount > 0 || retestCount > 0,
    },
  ].filter(item => item.count > 0 && !item.hidden);

  return (
    <div className="card train-judgment-summary-card">
      <div className="train-recent-scope-copy">
        <div className="train-route-eyebrow">学习状态摘要</div>
        <div className="train-judgment-summary-title">{summaryText}</div>
        {actionHint !== summaryText && (
          <div className="train-judgment-summary-hint">
            {actionHint}
          </div>
        )}
        {chips.length > 0 && (
          <div className="train-judgment-summary-chips" aria-label="掌握状态摘要">
            {chips.map(chip => (
              <span key={chip.label} className={`train-judgment-chip is-${chip.tone}`}>
                {chip.label} {chip.count}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TrainPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const practiceTarget = JSON.stringify(['kp', 'scope_type', 'scope_id', 'count'].map(key => params.get(key)));
  return <TrainSession key={practiceTarget} persistenceScope={`train:${practiceTarget}`} />;
}

function TrainSession({persistenceScope}: {persistenceScope: string}) {
  const [searchParams] = useSearchParams();
  const targetReportId = searchParams.get('report') || undefined;
  const targetReportHistory = searchParams.get('report_history') === '1';
  const targetDiagnosticAttemptId = searchParams.get('diagnostic_attempt') || undefined;
  const targetDiagnosticHistory = searchParams.get('diagnostic_history') === '1';
  const targetLearningTrace = searchParams.get('learning_trace') === '1';
  const targetKp = searchParams.get('kp') || undefined;
  const targetScopeType = searchParams.get('scope_type') === 'section' ? 'section'
    : searchParams.get('scope_type') === 'chapter' ? 'chapter'
      : undefined;
  const targetScopeId = searchParams.get('scope_id') || undefined;
  const targetScopeName = searchParams.get('scope_name') || targetScopeId || undefined;
  const requestedCount = Number(searchParams.get('count') || 5);
  const sessionCount = Number.isFinite(requestedCount)
    ? Math.max(1, Math.min(requestedCount, 20))
    : 5;
  const navigate = useNavigate();
  const location = useLocation();
  const studentId = getStudentId();
  const [restoredPractice]=useState(()=>loadPracticeRecord(studentId,persistenceScope));
  const restored=restoredPractice?.payload || {};
  const studentProfile = getStudentProfile();
  const canUseLearning = canEnterLearningArea(studentProfile);
  const hasFullLearningAccess = hasLearningAccess(studentProfile);
  const hasDirectTrainTarget = Boolean(
    targetReportId
    || targetReportHistory
    || targetDiagnosticAttemptId
    || targetDiagnosticHistory
    || targetLearningTrace,
  );

  const [phase, setPhase] = useState<Phase>(restored.session ? 'session' : targetLearningTrace && canUseLearning ? 'learning_trace' : 'entry');
  const [entryData, setEntryData] = useState<TrainStartData | null>(null);
  const [dirData, setDirData] = useState<DirectoryData | null>(null);
  const [entryLoading, setEntryLoading] = useState(canUseLearning);
  const [session, setSession] = useState<PracticeSession | null>((restored.session as PracticeSession) || null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [selectedChapterKey, setSelectedChapterKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scopeDiagnosticContext, setScopeDiagnosticContext] = useState<ScopeDiagnosticContext | null>((restored.scopeDiagnosticContext as ScopeDiagnosticContext) || null);
  const [scopeDiagnosticResult, setScopeDiagnosticResult] = useState<ScopeDiagnosticResult | null>((restored.scopeDiagnosticResult as ScopeDiagnosticResult) || null);
  const [improvementPlan, setImprovementPlan] = useState<ImprovementPlan | null>((restored.improvementPlan as ImprovementPlan) || null);
  const [practiceSessionContext, setPracticeSessionContext] = useState<PracticeSessionContext | null>((restored.practiceSessionContext as PracticeSessionContext) || null);
  const [activeImprovementTaskId, setActiveImprovementTaskId] = useState<string | null>((restored.activeImprovementTaskId as string) || null);
  const [activeImprovementTaskKpId, setActiveImprovementTaskKpId] = useState<string | null>((restored.activeImprovementTaskKpId as string) || null);
  const [submittingScopeDiagnostic, setSubmittingScopeDiagnostic] = useState(false);
  const [retestAttemptId, setRetestAttemptId] = useState<string | null>((restored.retestAttemptId as string) || null);
  const [retestSubmitting, setRetestSubmitting] = useState(false);
  const [retestResult, setRetestResult] = useState<ImprovementRetestResult | null>(null);
  const [practiceResultOpen, setPracticeResultOpen] = useState(false);
  const [improvementReport, setImprovementReport] = useState<ImprovementReport | null>(null);
  const [latestCompletedReport, setLatestCompletedReport] = useState<ImprovementReport | null>(null);
  const [reportHistoryItems, setReportHistoryItems] = useState<ImprovementReportListItem[]>([]);
  const [reportHistoryTotal, setReportHistoryTotal] = useState(0);
  const [reportHistoryOffset, setReportHistoryOffset] = useState(0);
  const [reportHistoryLoading, setReportHistoryLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportCopyStatus, setReportCopyStatus] = useState<string | null>(null);
  const [diagnosticHistoryItems, setDiagnosticHistoryItems] = useState<ScopeDiagnosticAttemptListItem[]>([]);
  const [diagnosticHistoryTotal, setDiagnosticHistoryTotal] = useState(0);
  const [diagnosticHistoryOffset, setDiagnosticHistoryOffset] = useState(0);
  const [diagnosticHistoryLoading, setDiagnosticHistoryLoading] = useState(false);
  const [selectedDiagnosticAttempt, setSelectedDiagnosticAttempt] = useState<ScopeDiagnosticAttemptDetail | null>(null);
  const [diagnosticAttemptLoading, setDiagnosticAttemptLoading] = useState(false);
  const [linkedPlanLoading, setLinkedPlanLoading] = useState(false);
  const [diagnosticReturnAttemptId, setDiagnosticReturnAttemptId] = useState<string | null>(null);
  const [learningTraceItems, setLearningTraceItems] = useState<LearningTraceEvent[]>([]);
  const [learningTraceTotal, setLearningTraceTotal] = useState(0);
  const [learningTraceOffset, setLearningTraceOffset] = useState(0);
  const [learningTraceLoading, setLearningTraceLoading] = useState(false);
  const [trainJudgments, setTrainJudgments] = useState<KnowledgeMasteryJudgment[]>([]);
  const [planTaskJudgments, setPlanTaskJudgments] = useState<Record<string, KnowledgeMasteryJudgment>>({});
  const [retestTaskJudgments, setRetestTaskJudgments] = useState<Record<string, KnowledgeMasteryJudgment>>({});
  const autoStartedTargetKpRef = useRef<string | null>(null);
  const autoLoadedReportIdRef = useRef<string | null>(null);
  const autoLoadedReportHistoryRef = useRef(false);
  const autoLoadedDiagnosticAttemptIdRef = useRef<string | null>(null);
  const autoLoadedDiagnosticHistoryRef = useRef(false);
  const autoLoadedLearningTraceRef = useRef(false);
  const improvementPlanRef = useRef<ImprovementPlan | null>(improvementPlan);
  const activeImprovementTaskIdRef = useRef<string | null>(activeImprovementTaskId);
  const activeImprovementTaskKpIdRef = useRef<string | null>(activeImprovementTaskKpId);
  const scopeDiagnosticFinalizingRef = useRef(false);
  const retestFinalizingRef = useRef(false);
  const completedPracticeSessionRef = useRef<string | null>(null);
  const submitAnswer = useCallback(async (questionId: string, answer: string, timeSpentMs: number, submissionId?: string) => (
    api.submitAnswer(studentId, {
      question_id: questionId,
      given_answer: answer,
      time_spent_ms: timeSpentMs,
      ...(submissionId && {submission_id:submissionId}),
      target_knowledge_point_id: session?.questions.find(question => question.id === questionId)
        ?.target_knowledge_point_id || targetKp || undefined,
    })
  ), [session, studentId, targetKp]);
  const {
    answers,
    collectedAnswers,
    currentIdx,
    showPaperBatch,
    resetSessionState,
    goToQuestion,
    togglePaperBatch,
    handleAnswer,
    handleAnsweredResult,
    handleBatchGraded,
    handleCollectAnswer,
    getQuestionTimeSpentMs,
    attemptId,
    persistSessionPayload,
  } = useQuestionSessionState({ submitAnswer,studentId,persistenceScope });

  useEffect(()=>{
    if(phase!=='session' || !session)return;
    persistSessionPayload({session,scopeDiagnosticContext,scopeDiagnosticResult,improvementPlan,
      practiceSessionContext,activeImprovementTaskId,activeImprovementTaskKpId,retestAttemptId});
  },[phase,session,scopeDiagnosticContext,scopeDiagnosticResult,improvementPlan,practiceSessionContext,
    activeImprovementTaskId,activeImprovementTaskKpId,retestAttemptId,persistSessionPayload,attemptId]);

  useEffect(() => {
    improvementPlanRef.current = improvementPlan;
  }, [improvementPlan]);

  const setActiveImprovementTask = useCallback((task: ImprovementPlan['tasks'][number] | null) => {
    const taskId = task?.id || null;
    const kpId = task?.kpId || null;
    activeImprovementTaskIdRef.current = taskId;
    activeImprovementTaskKpIdRef.current = kpId;
    setActiveImprovementTaskId(taskId);
    setActiveImprovementTaskKpId(kpId);
  }, []);

  const applyImprovementPlan = useCallback((plan: ImprovementPlan) => {
    improvementPlanRef.current = plan;
    setImprovementPlan(plan);
    setScopeDiagnosticResult(scopeResultFromImprovementPlan(plan));
    setScopeDiagnosticContext({
      scopeType: plan.scopeType,
      scopeId: plan.scopeId,
      scopeName: plan.scopeName,
    });
  }, []);

  const syncImprovementTaskStatus = useCallback(async (
    plan: ImprovementPlan,
    taskId: string,
    status: ImprovementPlan['tasks'][number]['status'],
  ): Promise<ImprovementPlan | null> => {
    if (!isPersistedImprovementPlan(plan)) return null;
    try {
      const updatedPlan = await api.updateImprovementTaskStatus(plan.id, taskId, status, studentId);
      applyImprovementPlan(updatedPlan);
      return updatedPlan;
    } catch {
      return null;
    }
  }, [applyImprovementPlan, studentId]);

  const chapterSummaries = useMemo(
    () => buildChapterSummaries(dirData, entryData?.recommended_kps || []),
    [dirData, entryData],
  );
  const volumeSummaries = useMemo(
    () => buildVolumeSummaries(chapterSummaries),
    [chapterSummaries],
  );
  const targetChapterName = targetScopeType === 'chapter'
    ? targetScopeId
    : targetScopeType === 'section'
      ? targetScopeId?.split('||')[0]
      : undefined;
  const recentlyPracticedChapter = useMemo(() => {
    return chapterSummaries
      .filter(chapter => !!chapter.latestLastPracticed)
      .sort((a, b) => (
        new Date(b.latestLastPracticed || '').getTime()
        - new Date(a.latestLastPracticed || '').getTime()
      ))[0] || null;
  }, [chapterSummaries]);
  const preferredChapter = useMemo(() => {
    if (targetChapterName) {
      const target = chapterSummaries.find(chapter => chapter.chapter === targetChapterName);
      if (target) return target;
    }
    if (recentlyPracticedChapter) return recentlyPracticedChapter;
    return chapterSummaries.find(chapter => chapter.weakKps.length > 0)
      || chapterSummaries.find(chapter => chapter.avgMastery < 0.7)
      || chapterSummaries[0]
      || null;
  }, [chapterSummaries, recentlyPracticedChapter, targetChapterName]);
  const preferredVolumeKey = preferredChapter?.volume || volumeSummaries[0]?.key || null;
  const [selectedVolumeKey, setSelectedVolumeKey] = useState<string | null>(null);
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);
  const activeVolumeKey = selectedVolumeKey || preferredVolumeKey;
  const visibleChapterSummaries = useMemo(
    () => activeVolumeKey
      ? chapterSummaries.filter(chapter => chapter.volume === activeVolumeKey)
      : [],
    [activeVolumeKey, chapterSummaries],
  );
  const selectedChapter = visibleChapterSummaries.find(chapter => chapter.key === selectedChapterKey)
    || (preferredChapter && visibleChapterSummaries.some(chapter => chapter.key === preferredChapter.key) ? preferredChapter : null)
    || visibleChapterSummaries.find(chapter => chapter.weakKps.length > 0)
    || visibleChapterSummaries.find(chapter => chapter.avgMastery < 0.7)
    || visibleChapterSummaries[0]
    || null;
  const activeTrainPlan = improvementPlan && improvementPlan.status !== 'completed' ? improvementPlan : null;
  const hasConcreteTrainEntryState = !!(
    activeTrainPlan
    || scopeDiagnosticResult
    || latestCompletedReport
    || improvementPlan?.status === 'completed'
  );
  const trainJudgmentRequest = useMemo<TrainJudgmentRequest | null>(() => {
    if (!canUseLearning || phase !== 'entry' || hasDirectTrainTarget || hasConcreteTrainEntryState) return null;
    if (targetScopeType && targetScopeId) {
      return { type: 'scope', scopeType: targetScopeType, scopeId: targetScopeId };
    }

    if (selectedChapter?.chapter) {
      return { type: 'scope', scopeType: 'chapter', scopeId: selectedChapter.chapter };
    }

    return null;
  }, [
    canUseLearning,
    hasConcreteTrainEntryState,
    hasDirectTrainTarget,
    phase,
    selectedChapter,
    targetScopeId,
    targetScopeType,
  ]);
  const trainJudgmentSummary = useMemo(
    () => summarizeKnowledgeMasteryJudgments(trainJudgments),
    [trainJudgments],
  );
  const planDetailJudgmentKpIds = useMemo(() => {
    if (!canUseLearning || phase !== 'scope_complete' || !improvementPlan?.tasks.length) return [];
    return uniqueIds(improvementPlan.tasks.map(task => task.kpId));
  }, [canUseLearning, improvementPlan, phase]);
  const retestResultJudgmentKpIds = useMemo(() => {
    if (!canUseLearning || phase !== 'retest_complete' || !retestResult?.taskResults.length) return [];
    return uniqueIds(retestResult.taskResults.map(item => item.kpId));
  }, [canUseLearning, phase, retestResult]);

  const handleSelectVolume = (volumeKey: string) => {
    setSelectedVolumeKey(volumeKey);
    setSelectedChapterKey(null);
    setVolumeMenuOpen(false);
  };

  useEffect(() => {
    if (!trainJudgmentRequest) {
      setTrainJudgments([]);
      return undefined;
    }
    let cancelled = false;
    const loadTrainJudgments = async () => {
      try {
        const response = trainJudgmentRequest.type === 'kps'
          ? await api.getKnowledgeMasteryJudgments(trainJudgmentRequest.kpIds, studentId)
          : await api.getScopeKnowledgeMasteryJudgments(
            trainJudgmentRequest.scopeType,
            trainJudgmentRequest.scopeId,
            studentId,
          );
        if (!cancelled) setTrainJudgments(response.items || []);
      } catch (e) {
        console.warn('加载巩固提升掌握判读失败', e);
        if (!cancelled) setTrainJudgments([]);
      }
    };
    void loadTrainJudgments();
    return () => {
      cancelled = true;
    };
  }, [studentId, trainJudgmentRequest]);

  useEffect(() => {
    if (!planDetailJudgmentKpIds.length) {
      setPlanTaskJudgments({});
      return undefined;
    }
    let cancelled = false;
    const loadPlanTaskJudgments = async () => {
      try {
        const response = await api.getKnowledgeMasteryJudgments(planDetailJudgmentKpIds, studentId);
        if (!cancelled) setPlanTaskJudgments(mapJudgmentsByKpId(response.items || []));
      } catch (e) {
        console.warn('加载提升路径掌握判读失败', e);
        if (!cancelled) setPlanTaskJudgments({});
      }
    };
    void loadPlanTaskJudgments();
    return () => {
      cancelled = true;
    };
  }, [planDetailJudgmentKpIds, studentId]);

  useEffect(() => {
    if (!retestResultJudgmentKpIds.length) {
      setRetestTaskJudgments({});
      return undefined;
    }
    let cancelled = false;
    const loadRetestTaskJudgments = async () => {
      try {
        const response = await api.getKnowledgeMasteryJudgments(retestResultJudgmentKpIds, studentId);
        if (!cancelled) setRetestTaskJudgments(mapJudgmentsByKpId(response.items || []));
      } catch (e) {
        console.warn('加载复测结果掌握判读失败', e);
        if (!cancelled) setRetestTaskJudgments({});
      }
    };
    void loadRetestTaskJudgments();
    return () => {
      cancelled = true;
    };
  }, [retestResultJudgmentKpIds, studentId]);

  useEffect(() => {
    if (!visibleChapterSummaries.length) return;
    if (!selectedChapterKey || !visibleChapterSummaries.some(chapter => chapter.key === selectedChapterKey)) {
      setSelectedChapterKey(selectedChapter?.key || visibleChapterSummaries[0].key);
    }
  }, [selectedChapter, selectedChapterKey, visibleChapterSummaries]);

  // ── Entry Phase ──

  const startSession = useCallback(async (
    kpId: string,
    options: {
      preserveActiveTask?: boolean;
      title?: string;
      returnTarget?: PracticeSessionReturnTarget;
    } = {},
  ) => {
    if (!canUseLearning) return;
    if (!options.preserveActiveTask) {
      setActiveImprovementTask(null);
    }
    setSessionLoading(true);
    setError(null);
    try {
      const target = kpId || undefined;
      const s = await api.getPracticeSession(studentId, target, sessionCount);
      setSession(s);
      setPracticeSessionContext({
        title: options.title || '混合提升',
        returnTarget: options.returnTarget || 'entry',
      });
      setPracticeResultOpen(false);
      completedPracticeSessionRef.current = null;
      resetSessionState();
      setRetestAttemptId(null);
      setPhase('session');
    } catch (e: any) {
      setError(e.message || '加载练习失败');
    } finally {
      setSessionLoading(false);
    }
  }, [canUseLearning, resetSessionState, sessionCount, setActiveImprovementTask, studentId]);

  const startImprovementTask = useCallback((taskId: string) => {
    if (!improvementPlan) return;
    if (improvementPlan.status === 'completed') return;
    const task = getTaskById(improvementPlan, taskId);
    if (!task) return;
    if (task.status === 'passed') return;
    if (task.status === 'practiced' && improvementPlan.status === 'ready_for_retest') return;
    setActiveImprovementTask(task);
    const optimisticPlan = updateImprovementTaskStatus(improvementPlan, task.id, 'in_progress');
    improvementPlanRef.current = optimisticPlan;
    setImprovementPlan(optimisticPlan);
    void syncImprovementTaskStatus(improvementPlan, task.id, 'in_progress');
    void startSession(task.kpId, {
      preserveActiveTask: true,
      title: '专项练',
      returnTarget: 'scope_complete',
    });
  }, [improvementPlan, setActiveImprovementTask, startSession, syncImprovementTaskStatus]);

  const startImprovementPracticeByKp = useCallback((kpId: string) => {
    const task = improvementPlan?.tasks.find(item => item.kpId === kpId);
    if (task) {
      startImprovementTask(task.id);
      return;
    }
    void startSession(kpId, {
      title: '专项练',
      returnTarget: scopeDiagnosticResult ? 'scope_complete' : 'entry',
    });
  }, [improvementPlan, scopeDiagnosticResult, startImprovementTask, startSession]);

  const loadLatestCompletedReportForEntry = useCallback(async () => {
    try {
      const report = await api.getLatestCompletedImprovementReport(studentId);
      setLatestCompletedReport(report);
    } catch {
      setLatestCompletedReport(null);
    }
  }, [studentId]);

  const fetchEntry = useCallback(async () => {
    if (!canUseLearning) {
      setEntryLoading(false);
      return;
    }
    if (hasDirectTrainTarget) {
      setEntryLoading(false);
      return;
    }
    setEntryLoading(true);
    setError(null);
    void loadLatestCompletedReportForEntry();
    try {
      if (targetKp && autoStartedTargetKpRef.current !== targetKp) {
        const directory = await api.getDirectory(studentId);
        setDirData(directory);
        setEntryData({ is_first_time: false, has_diagnosed: false, recommended_kps: [] });
        autoStartedTargetKpRef.current = targetKp;
        await startSession(targetKp);
        return;
      }
      if (!hasFullLearningAccess) {
        const [directory, latestPlan] = await Promise.all([
          api.getDirectory(studentId),
          api.getLatestImprovementPlan(studentId).catch(() => null),
        ]);
        // Browsing the catalog does not grant practice access. Keep all chapters
        // visible, as on native clients, and gate the action rather than the list.
        setDirData(directory);
        setEntryData({ is_first_time: false, has_diagnosed: false, recommended_kps: [] });
        if (latestPlan) applyImprovementPlan(latestPlan);
        return;
      }
      const [d, directory, latestPlan] = await Promise.all([
        api.getTrainStart(studentId),
        api.getDirectory(studentId),
        api.getLatestImprovementPlan(studentId).catch(() => null),
      ]);
      setEntryData(d);
      setDirData(directory);
      if (latestPlan) applyImprovementPlan(latestPlan);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setEntryLoading(false);
    }
  }, [applyImprovementPlan, canUseLearning, hasDirectTrainTarget, hasFullLearningAccess, loadLatestCompletedReportForEntry, startSession, studentId, targetKp]);

  useEffect(() => { if (phase === 'entry') fetchEntry(); }, [phase, fetchEntry]);

  const startScopeDiagnostic = useCallback(async (scopeType: 'chapter' | 'section', scopeId: string) => {
    if (scopeType === 'chapter' && !hasLearningAccess(getStudentProfile())) {
      navigate('/login');
      return;
    }
    setSessionLoading(true);
    setError(null);
    try {
      const questionCount = scopeType === 'chapter' ? 10 : 6;
      const s = await api.scopeDiagnose(scopeType, scopeId, questionCount, studentId);
      setSession(s);
      setScopeDiagnosticContext({
        scopeType,
        scopeId,
        scopeName: scopeType === 'section' ? scopeId.split('||')[1] || scopeId : scopeId,
      });
      setScopeDiagnosticResult(null);
      scopeDiagnosticFinalizingRef.current = false;
      setPracticeResultOpen(false);
      setPracticeSessionContext(null);
      setRetestAttemptId(null);
      setRetestResult(null);
      setImprovementReport(null);
      setDiagnosticReturnAttemptId(null);
      improvementPlanRef.current = null;
      setImprovementPlan(null);
      setActiveImprovementTask(null);
      resetSessionState();
      setPhase('session');
    } catch (e: any) {
      setError(e.message || '检测启动失败');
    } finally {
      setSessionLoading(false);
    }
  }, [navigate, resetSessionState, setActiveImprovementTask, studentId]);

  const goToTrainEntry = useCallback(() => {
    navigate('/train');
    setPhase('entry');
    setSession(null);
    setPracticeSessionContext(null);
    setRetestAttemptId(null);
    setRetestResult(null);
    setImprovementReport(null);
    setSelectedDiagnosticAttempt(null);
    setDiagnosticReturnAttemptId(null);
    setActiveImprovementTask(null);
    setError(null);
    setReportCopyStatus(null);
    resetSessionState({preserveSaved:true});
  }, [navigate, resetSessionState, setActiveImprovementTask]);

  const handleBackToEntry = useCallback(() => {
    if (
      !targetReportId
      && !targetReportHistory
      && !targetDiagnosticAttemptId
      && !targetDiagnosticHistory
      && !targetLearningTrace
      && targetKp
      && getReturnState(location).from
    ) {
      navigateBackToPreviousPage(navigate, location, '/train', { state: { restoreKpId: targetKp } });
      return;
    }
    goToTrainEntry();
  }, [goToTrainEntry, location, navigate, targetDiagnosticAttemptId, targetDiagnosticHistory, targetKp, targetLearningTrace, targetReportHistory, targetReportId]);

  const handleSessionBack = useCallback(() => {
    if (practiceSessionContext?.returnTarget === 'scope_complete' && scopeDiagnosticResult) {
      setPhase('scope_complete');
      setSession(null);
      setPracticeSessionContext(null);
      setRetestAttemptId(null);
      setError(null);
      resetSessionState({preserveSaved:true});
      return;
    }
    handleBackToEntry();
  }, [handleBackToEntry, practiceSessionContext, resetSessionState, scopeDiagnosticResult]);

  const handleSubmitScopeDiagnostic = async () => {
    if (
      !session
      || !scopeDiagnosticContext
      || scopeDiagnosticResult
      || scopeDiagnosticFinalizingRef.current
      || !session.questions.every(question => !!answers[question.id])
    ) return;
    scopeDiagnosticFinalizingRef.current = true;
    setSubmittingScopeDiagnostic(true);
    setError(null);
    try {
      const result = await api.getSubmittedScopeDiagnosticFeedback(
        scopeDiagnosticContext.scopeType,
        scopeDiagnosticContext.scopeId,
        buildSubmittedDiagnosticAnswers(answers),
        studentId,
      );
      const localPlan = buildImprovementPlan(result, dirData);
      setScopeDiagnosticResult(result);
      improvementPlanRef.current = localPlan;
      setImprovementPlan(localPlan);
      void api.createImprovementPlanFromScopeResult(result, studentId)
        .then((serverPlan) => {
          const currentPlan = improvementPlanRef.current;
          const activeTask = currentPlan
            ? resolveActiveTask(
              currentPlan,
              activeImprovementTaskIdRef.current,
              activeImprovementTaskKpIdRef.current,
            )
            : null;
          const serverTask = resolveActiveTask(
            serverPlan,
            activeImprovementTaskIdRef.current,
            activeTask?.kpId || activeImprovementTaskKpIdRef.current,
          );
          const carriedStatus = activeTask?.status === 'in_progress' || activeTask?.status === 'practiced'
            ? activeTask.status
            : null;
          const nextServerPlan = serverTask && carriedStatus
            ? updateImprovementTaskStatus(serverPlan, serverTask.id, carriedStatus)
            : serverPlan;

          if (serverTask) {
            setActiveImprovementTask(serverTask);
          }
          applyImprovementPlan(nextServerPlan);
          if (serverTask && carriedStatus) {
            void syncImprovementTaskStatus(serverPlan, serverTask.id, carriedStatus);
          }
        })
        .catch(() => {
          // 后端计划不可用时保留前端本地计划，学生路径不中断。
        });
    } catch (e: any) {
      setError(e.message || '检测结果生成失败');
    } finally {
      scopeDiagnosticFinalizingRef.current = false;
      setSubmittingScopeDiagnostic(false);
    }
  };

  const restartScopeDiagnostic = useCallback(() => {
    const result = scopeDiagnosticResult;
    if (!result) return;
    setImprovementPlan(null);
    improvementPlanRef.current = null;
    setScopeDiagnosticResult(null);
    setScopeDiagnosticContext(null);
    setRetestAttemptId(null);
    setRetestResult(null);
    setImprovementReport(null);
    setActiveImprovementTask(null);
    void startScopeDiagnostic(result.scope_type, result.scope_id);
  }, [scopeDiagnosticResult, setActiveImprovementTask, startScopeDiagnostic]);

  const startImprovementRetest = useCallback(async () => {
    if (!improvementPlan) return;
    if (!isPersistedImprovementPlan(improvementPlan)) {
      setError('阶段复测需要先生成后端提升计划，请稍后再试。');
      return;
    }
    setSessionLoading(true);
    setError(null);
    try {
      const response = await api.startImprovementRetest(improvementPlan.id, undefined, studentId);
      applyImprovementPlan(response.plan);
      setRetestAttemptId(response.attemptId);
      setRetestResult(null);
      retestFinalizingRef.current = false;
      setPracticeResultOpen(false);
      setSession(response.session);
      setPracticeSessionContext(null);
      setActiveImprovementTask(null);
      resetSessionState();
      setPhase('session');
    } catch (e: any) {
      setError(`阶段复测启动失败：${normalizeImprovementErrorMessage(e.message || '请稍后再试')}`);
    } finally {
      setSessionLoading(false);
    }
  }, [applyImprovementPlan, improvementPlan, resetSessionState, setActiveImprovementTask, studentId]);

  const handleSubmitImprovementRetest = async () => {
    if (
      !improvementPlan
      || !retestAttemptId
      || retestResult
      || retestFinalizingRef.current
      || !session?.questions.every(question => !!answers[question.id])
    ) return;
    retestFinalizingRef.current = true;
    setRetestSubmitting(true);
    setError(null);
    try {
      const result = await api.submitImprovementRetestFeedback(
        improvementPlan.id,
        retestAttemptId,
        buildSubmittedDiagnosticAnswers(answers),
        studentId,
      );
      applyImprovementPlan(result.plan);
      setRetestResult(result);
    } catch (e: any) {
      setError(`复测结果生成失败：${e.message || '请稍后再试'}`);
    } finally {
      retestFinalizingRef.current = false;
      setRetestSubmitting(false);
    }
  };

  const loadImprovementReport = useCallback(async (planId?: string) => {
    setReportLoading(true);
    setError(null);
    setReportCopyStatus(null);
    try {
      const report = planId
        ? await api.getImprovementReport(planId, studentId)
        : await api.getLatestCompletedImprovementReport(studentId);
      if (!report) {
        throw new Error('暂无可查看的提升报告');
      }
      setImprovementReport(report);
      setPhase('report');
    } catch (e: any) {
      setError(`提升报告加载失败：${e.message || '请稍后再试'}`);
    } finally {
      setReportLoading(false);
    }
  }, [studentId]);

  const loadReportHistory = useCallback(async (reset = true) => {
    const limit = 10;
    const offset = reset ? 0 : reportHistoryOffset;
    setReportHistoryLoading(true);
    setError(null);
    try {
      const result = await api.listImprovementReports(studentId, { limit, offset });
      setReportHistoryItems(current => (reset ? result.items : [...current, ...result.items]));
      setReportHistoryTotal(result.total);
      setReportHistoryOffset(offset + result.items.length);
      if (reset) setPhase('report_history');
    } catch (e: any) {
      setError(`提升报告历史加载失败：${e.message || '请稍后再试'}`);
      if (reset) setPhase('report_history');
    } finally {
      setReportHistoryLoading(false);
    }
  }, [reportHistoryOffset, studentId]);

  const openImprovementReport = useCallback((planId: string, options: { returnAttemptId?: string | null } = {}) => {
    setDiagnosticReturnAttemptId(options.returnAttemptId || null);
    autoLoadedReportIdRef.current = planId;
    autoLoadedReportHistoryRef.current = false;
    navigate(`/train?report=${encodeURIComponent(planId)}`);
    void loadImprovementReport(planId);
  }, [loadImprovementReport, navigate]);

  const openReportHistory = useCallback(() => {
    autoLoadedReportHistoryRef.current = true;
    navigate('/train?report_history=1');
    void loadReportHistory(true);
  }, [loadReportHistory, navigate]);

  const loadDiagnosticHistory = useCallback(async (reset = true) => {
    const limit = 10;
    const offset = reset ? 0 : diagnosticHistoryOffset;
    setDiagnosticHistoryLoading(true);
    setError(null);
    try {
      const result = await api.listScopeDiagnosticAttempts(studentId, { limit, offset });
      setDiagnosticHistoryItems(current => (reset ? result.items : [...current, ...result.items]));
      setDiagnosticHistoryTotal(result.total);
      setDiagnosticHistoryOffset(offset + result.items.length);
      if (reset) setPhase('diagnostic_history');
    } catch (e: any) {
      if (reset) {
        setDiagnosticHistoryItems([]);
        setDiagnosticHistoryTotal(0);
        setDiagnosticHistoryOffset(0);
      }
      setError(`检测历史加载失败：${e.message || '请稍后再试'}`);
      if (reset) setPhase('diagnostic_history');
    } finally {
      setDiagnosticHistoryLoading(false);
    }
  }, [diagnosticHistoryOffset, studentId]);

  const loadLearningTrace = useCallback(async (reset = true) => {
    const limit = 20;
    const offset = reset ? 0 : learningTraceOffset;
    setLearningTraceLoading(true);
    setError(null);
    try {
      const result = await api.listLearningTrace(studentId, { limit, offset });
      setLearningTraceItems(current => (reset ? result.items : [...current, ...result.items]));
      setLearningTraceTotal(result.total);
      setLearningTraceOffset(offset + result.items.length);
      if (reset) setPhase('learning_trace');
    } catch (e: any) {
      if (reset) {
        setLearningTraceItems([]);
        setLearningTraceTotal(0);
        setLearningTraceOffset(0);
      }
      setError(`学习轨迹加载失败：${e.message || '请稍后再试'}`);
      if (reset) setPhase('learning_trace');
    } finally {
      setLearningTraceLoading(false);
    }
  }, [learningTraceOffset, studentId]);

  const loadDiagnosticAttempt = useCallback(async (attemptId: string) => {
    setDiagnosticAttemptLoading(true);
    setError(null);
    try {
      const attempt = await api.getScopeDiagnosticAttempt(attemptId, studentId);
      setSelectedDiagnosticAttempt(attempt);
      setPhase('diagnostic_attempt');
    } catch (e: any) {
      setSelectedDiagnosticAttempt(null);
      setError(`检测结果加载失败：${e.message || '请稍后再试'}`);
      setPhase('diagnostic_attempt');
    } finally {
      setDiagnosticAttemptLoading(false);
    }
  }, [studentId]);

  const openDiagnosticHistory = useCallback(() => {
    setDiagnosticReturnAttemptId(null);
    autoLoadedDiagnosticHistoryRef.current = true;
    navigate('/train?diagnostic_history=1');
    void loadDiagnosticHistory(true);
  }, [loadDiagnosticHistory, navigate]);

  const openDiagnosticAttempt = useCallback((attemptId: string) => {
    setDiagnosticReturnAttemptId(null);
    autoLoadedDiagnosticAttemptIdRef.current = attemptId;
    autoLoadedDiagnosticHistoryRef.current = false;
    navigate(`/train?diagnostic_attempt=${encodeURIComponent(attemptId)}`);
    void loadDiagnosticAttempt(attemptId);
  }, [loadDiagnosticAttempt, navigate]);

  const openLinkedImprovementPlan = useCallback(async (
    planId: string,
    options: { returnAttemptId?: string | null; preserveSelectedAttempt?: boolean } = {},
  ) => {
    const fallbackPhase = phase;
    setDiagnosticReturnAttemptId(options.returnAttemptId || null);
    setLinkedPlanLoading(true);
    setPhase('scope_complete');
    setError(null);
    try {
      const plan = await api.getImprovementPlan(planId, studentId);
      applyImprovementPlan(plan);
      if (!options.preserveSelectedAttempt) {
        setSelectedDiagnosticAttempt(null);
      }
      setSession(null);
      resetSessionState();
      setPhase('scope_complete');
      navigate('/train');
    } catch (e: any) {
      setError(`提升路径加载失败：${e.message || '请稍后再试'}`);
      setPhase(fallbackPhase);
    } finally {
      setLinkedPlanLoading(false);
    }
  }, [applyImprovementPlan, navigate, phase, resetSessionState, studentId]);

  const openLinkedPlanFromDiagnosticAttempt = useCallback((planId: string) => {
    void openLinkedImprovementPlan(planId, {
      returnAttemptId: selectedDiagnosticAttempt?.attemptId || null,
      preserveSelectedAttempt: true,
    });
  }, [openLinkedImprovementPlan, selectedDiagnosticAttempt]);

  const openImprovementReportFromDiagnosticAttempt = useCallback((planId: string) => {
    openImprovementReport(planId, {
      returnAttemptId: selectedDiagnosticAttempt?.attemptId || null,
    });
  }, [openImprovementReport, selectedDiagnosticAttempt]);

  const returnToDiagnosticAttempt = useCallback(() => {
    const attemptId = diagnosticReturnAttemptId || selectedDiagnosticAttempt?.attemptId;
    if (!attemptId) {
      openDiagnosticHistory();
      return;
    }

    autoLoadedDiagnosticAttemptIdRef.current = attemptId;
    navigate(`/train?diagnostic_attempt=${encodeURIComponent(attemptId)}`);
    if (selectedDiagnosticAttempt?.attemptId === attemptId) {
      setError(null);
      setPhase('diagnostic_attempt');
      return;
    }

    void loadDiagnosticAttempt(attemptId);
  }, [
    diagnosticReturnAttemptId,
    loadDiagnosticAttempt,
    navigate,
    openDiagnosticHistory,
    selectedDiagnosticAttempt,
  ]);

  const rediagnoseFromAttempt = useCallback((scopeType: 'chapter' | 'section', scopeId: string) => {
    navigate('/train');
    setSelectedDiagnosticAttempt(null);
    setDiagnosticReturnAttemptId(null);
    void startScopeDiagnostic(scopeType, scopeId);
  }, [navigate, startScopeDiagnostic]);

  const handleCopyReportSummary = useCallback(async () => {
    if (!improvementReport) return;
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      setReportCopyStatus('复制失败，请手动选择报告内容');
      return;
    }
    try {
      await clipboard.writeText(buildReportShareText(improvementReport));
      setReportCopyStatus('报告摘要已复制');
    } catch {
      setReportCopyStatus('复制失败，请手动选择报告内容');
    }
  }, [improvementReport]);

  useEffect(() => {
    if (!targetReportId) {
      autoLoadedReportIdRef.current = null;
    }
    if (!targetReportHistory) {
      autoLoadedReportHistoryRef.current = false;
    }
    if (!targetDiagnosticAttemptId) {
      autoLoadedDiagnosticAttemptIdRef.current = null;
    }
    if (!targetDiagnosticHistory) {
      autoLoadedDiagnosticHistoryRef.current = false;
    }
    if (!targetLearningTrace) {
      autoLoadedLearningTraceRef.current = false;
    }
  }, [targetDiagnosticAttemptId, targetDiagnosticHistory, targetLearningTrace, targetReportHistory, targetReportId]);

  useEffect(() => {
    if (!canUseLearning) return;
    if (targetReportId) {
      if (autoLoadedReportIdRef.current === targetReportId) return;
      autoLoadedReportIdRef.current = targetReportId;
      setDiagnosticReturnAttemptId(targetDiagnosticAttemptId || null);
      void loadImprovementReport(targetReportId);
      return;
    }
    if (targetReportHistory && !autoLoadedReportHistoryRef.current) {
      autoLoadedReportHistoryRef.current = true;
      void loadReportHistory(true);
      return;
    }
    if (targetDiagnosticAttemptId) {
      if (autoLoadedDiagnosticAttemptIdRef.current === targetDiagnosticAttemptId) return;
      autoLoadedDiagnosticAttemptIdRef.current = targetDiagnosticAttemptId;
      void loadDiagnosticAttempt(targetDiagnosticAttemptId);
      return;
    }
    if (targetDiagnosticHistory && !autoLoadedDiagnosticHistoryRef.current) {
      autoLoadedDiagnosticHistoryRef.current = true;
      void loadDiagnosticHistory(true);
      return;
    }
    if (targetLearningTrace && !autoLoadedLearningTraceRef.current) {
      autoLoadedLearningTraceRef.current = true;
      void loadLearningTrace(true);
    }
  }, [
    canUseLearning,
    loadDiagnosticAttempt,
    loadDiagnosticHistory,
    loadImprovementReport,
    loadLearningTrace,
    loadReportHistory,
    targetDiagnosticAttemptId,
    targetDiagnosticHistory,
    targetLearningTrace,
    targetReportHistory,
    targetReportId,
  ]);

  // ── Entry Phase UI ──

  if (phase === 'entry') {
    if (!canUseLearning) {
      return (
        <LearningWorkspace className="container train-workspace train-entry-workspace">
          <TrainHeader
            title="巩固提升"
            subtitle="按教材章节选择巩固路径，完成检测、补弱、回看和混合提升。"
          />
          <AccountAccessPanel
            features={['单元检测', '专项练习', '纸笔批改', '变式巩固']}
          />
        </LearningWorkspace>
      );
    }

    if (entryLoading) return <div className="loading">加载中...</div>;
    if (isLearningAccessError(error)) return (
      <LearningWorkspace className="container train-workspace train-entry-workspace">
        <TrainHeader
          title="巩固提升"
          subtitle="账号不可用，请重新登录或联系部署管理员。"
        />
        <AccountAccessPanel
          title="账号不可用，请重新登录或联系部署管理员。"
          description="账号不可用，请重新登录或联系部署管理员。"
          features={['单元检测', '专项练习', '纸笔批改', '变式巩固']}
        />
      </LearningWorkspace>
    );
    if (error && targetReportId) return (
      <div className="container train-workspace train-error-state">
        <div className="error-banner">{error}</div>
        <div className="train-footer-actions train-complete-actions">
          <button type="button" onClick={goToTrainEntry} className="train-route-secondary-button">
            返回巩固提升首页
          </button>
          <button
            type="button"
            onClick={() => { void loadImprovementReport(targetReportId); }}
            className="train-route-primary-button"
          >
            重试加载
          </button>
        </div>
      </div>
    );
    if (error) return (
      <div className="container train-workspace train-error-state">
        <div className="error-banner">{error}</div>
        <button onClick={fetchEntry} style={{
          padding: '8px 16px', borderRadius: 4, border: '1px solid #d9d9d9',
          background: '#fff', cursor: 'pointer', fontSize: 13,
        }}>重试</button>
      </div>
    );
    return (
      <LearningWorkspace className="container train-workspace train-entry-workspace">
        <TrainHeader
          title="巩固提升"
          subtitle="按教材章节选择巩固路径，完成检测、补弱、回看和混合提升。"
        />

        <div className="learning-path-grid train-entry-grid">
          <div className="card train-control-panel">
            <div className="train-control-header">
              <span>学习控制面板</span>
              <h2>选择教材与章节</h2>
            </div>

            {volumeSummaries.length > 0 && (
              <div className="train-volume-menu">
                <button
                  type="button"
                  className="train-volume-trigger"
                  onClick={() => setVolumeMenuOpen(open => !open)}
                  aria-expanded={volumeMenuOpen}
                  aria-controls="train-volume-list"
                >
                  <span aria-hidden="true" className="train-volume-menu-icon">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>{activeVolumeKey || '选择教材'}</span>
                </button>
                {volumeMenuOpen && (
                  <div className="train-volume-dropdown" id="train-volume-list" role="menu">
                    {volumeSummaries.map(volume => (
                      <button
                        type="button"
                        className={`train-volume-option${volume.key === activeVolumeKey ? ' is-active' : ''}`}
                        key={volume.key}
                        onClick={() => handleSelectVolume(volume.key)}
                        role="menuitem"
                      >
                        <span>{volume.name}</span>
                        <small>{volume.chapterCount} 章 · 薄弱 {volume.weakCount}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <ChapterList
              chapters={visibleChapterSummaries}
              activeChapterKey={selectedChapter?.key}
              getKey={(chapter) => chapter.key}
              getTitle={(chapter) => chapter.chapter}
              getMeta={(chapter) => `${chapter.mastered}/${chapter.total} 已掌握 · ${Math.round(chapter.avgMastery * 100)}% 平均掌握`}
              getStatus={(chapter) => chapter.status}
              getMasteryPercent={(chapter) => chapter.avgMastery * 100}
              onSelectChapter={(chapter) => setSelectedChapterKey(chapter.key)}
              className="train-chapter-list"
            />
          </div>

          <div className="train-session-panel">
            {scopeDiagnosticResult && (
              <RecentScopeDiagnosticCard
                result={scopeDiagnosticResult}
                plan={improvementPlan}
                sessionLoading={sessionLoading}
                onView={() => setPhase('scope_complete')}
                onContinue={startImprovementPracticeByKp}
                onRediagnose={restartScopeDiagnostic}
              />
            )}
            <ChapterRoutePanel
              chapter={selectedChapter}
              targetScopeType={targetScopeType}
              targetScopeId={targetScopeId}
              targetScopeName={targetScopeName}
              sessionLoading={sessionLoading}
              onStartScopeDiagnostic={startScopeDiagnostic}
              onViewDiagnosticHistory={openDiagnosticHistory}
            />
            {!hasConcreteTrainEntryState && trainJudgmentSummary.total > 0 && (
              <TrainJudgmentSummaryCard
                summary={trainJudgmentSummary}
              />
            )}
            {latestCompletedReport && (
              <RecentCompletedReportCard
                report={latestCompletedReport}
                onView={() => openImprovementReport(latestCompletedReport.summary.planId)}
                onHistory={openReportHistory}
              />
            )}
          </div>
        </div>
      </LearningWorkspace>
    );
  }

  const practiceSummary = buildPracticeSummary(answers);
  const isImprovementPractice = Boolean(activeImprovementTaskId && improvementPlan);
  const nextImprovementTask = improvementPlan ? getNextActionableImprovementTask(improvementPlan) : null;
  const resetToEntry = () => {
    setPracticeResultOpen(false);
    setPhase('entry');
    setSession(null);
    setPracticeSessionContext(null);
    setActiveImprovementTask(null);
    resetSessionState();
  };
  const backToImprovementPlan = () => {
    setPracticeResultOpen(false);
    setPhase('scope_complete');
    setSession(null);
    setPracticeSessionContext(null);
    setActiveImprovementTask(null);
    resetSessionState();
  };
  const startNextImprovementTaskFromPlan = (plan: ImprovementPlan) => {
    const nextTask = getNextActionableImprovementTask(plan);
    if (!nextTask) {
      backToImprovementPlan();
      return;
    }
    setActiveImprovementTask(nextTask);
    const optimisticPlan = updateImprovementTaskStatus(plan, nextTask.id, 'in_progress');
    improvementPlanRef.current = optimisticPlan;
    setImprovementPlan(optimisticPlan);
    void syncImprovementTaskStatus(plan, nextTask.id, 'in_progress');
    void startSession(nextTask.kpId, {
      preserveActiveTask: true,
      title: '专项练',
      returnTarget: 'scope_complete',
    });
  };
  const continueWithLocalNextImprovementTask = (plan: ImprovementPlan) => {
    const movedPlan = moveToNextImprovementTask(plan);
    improvementPlanRef.current = movedPlan;
    setImprovementPlan(movedPlan);
    startNextImprovementTaskFromPlan(movedPlan);
  };
  const startServerResolvedNextTask = (plan: ImprovementPlan) => {
    const nextTask = getTaskById(plan, plan.currentTaskId)
      || getNextActionableImprovementTask(plan);
    if (!nextTask) {
      backToImprovementPlan();
      return;
    }
    setActiveImprovementTask(nextTask);
    setSession(null);
    void startSession(nextTask.kpId, {
      preserveActiveTask: true,
      title: '专项练',
      returnTarget: 'scope_complete',
    });
  };
  const continueNextImprovementTask = () => {
    setPracticeResultOpen(false);
    if (!improvementPlan) {
      backToImprovementPlan();
      return;
    }
    if (!isPersistedImprovementPlan(improvementPlan)) {
      continueWithLocalNextImprovementTask(improvementPlan);
      return;
    }
    void api.moveToNextImprovementTaskOnServer(improvementPlan.id, studentId)
      .then((serverPlan) => {
        applyImprovementPlan(serverPlan);
        startServerResolvedNextTask(serverPlan);
      })
      .catch(() => {
        continueWithLocalNextImprovementTask(improvementPlan);
      });
  };

  // ── Session Phase UI ──

  if (phase === 'session') {
    if (sessionLoading) return <div className="loading">加载练习中...</div>;

    if (!session || session.questions.length === 0) {
      return (
        <div className="container train-workspace train-empty-state">
          <TrainHeader title="练习" subtitle="暂无可用题目" />
        </div>
      );
    }

    const isScopeDiagnosticSession = !!scopeDiagnosticContext && session.session_type === 'scope_diagnostic';
    const isImprovementRetestSession = session.session_type === 'improvement_retest';
    const isWholeSetSession = isScopeDiagnosticSession || isImprovementRetestSession || !isImprovementPractice;
    const answeredCount = Object.keys(answers).length;
    const total = session.questions.length;
    const allScopeDiagnosticAnswered = isScopeDiagnosticSession
      && session.questions.every(q => !!answers[q.id]);
    const allRetestAnswered = isImprovementRetestSession
      && session.questions.every(q => !!answers[q.id]);
    const allPracticeAnswered = !isScopeDiagnosticSession && !isImprovementRetestSession
      && session.questions.every(q => !!answers[q.id]);
    const handlePracticeComplete = () => {
      const sessionKey = session.questions.map(question => question.id).join('|');
      if (completedPracticeSessionRef.current === sessionKey) return;
      completedPracticeSessionRef.current = sessionKey;
      if (improvementPlan) {
        const activeTask = resolveActiveTask(
          improvementPlan,
          activeImprovementTaskId,
          activeImprovementTaskKpId,
        );
        if (activeTask) {
          setActiveImprovementTask(activeTask);
          const practicedPlan = updateImprovementTaskStatus(improvementPlan, activeTask.id, 'practiced');
          improvementPlanRef.current = practicedPlan;
          setImprovementPlan(practicedPlan);
          void syncImprovementTaskStatus(improvementPlan, activeTask.id, 'practiced');
        }
      }
    };

    const title = isImprovementRetestSession
      ? '阶段复测'
      : isScopeDiagnosticSession
        ? (scopeDiagnosticContext.scopeType === 'section' ? '小节检测' : '单元检测')
        : session.session_type !== 'practice'
          ? STRATEGY_LABELS[session.strategy] || session.strategy
        : practiceSessionContext?.title || '混合提升';
    const subtitle = session.session_objective || STRATEGY_LABELS[session.strategy] || session.strategy;

    return (
      <>
      <QuestionSessionRunner
        key={attemptId}
        persistenceKey={attemptId}
        title={title}
        subtitle={subtitle}
        printTitle={title}
        questions={session.questions}
        currentIndex={currentIdx}
        answeredCount={answeredCount}
        progressForQuestion={(questionId) => {
          if (isScopeDiagnosticSession) {
            const answer = answers[questionId];
            return { answered: !!answer, correct: answer?.is_correct };
          }
          const answer = answers[questionId];
          return { answered: !!answer, correct: answer?.is_correct };
        }}
        resultForQuestion={(questionId) => answers[questionId]}
        statusForQuestion={(questionId) => {
          const answer = answers[questionId];
          if (!answer) {
            if (isScopeDiagnosticSession && collectedAnswers[questionId]) {
              return <span style={{ color: '#52c41a', fontWeight: 600 }}>已作答</span>;
            }
            return null;
          }
          return (
            <span style={{ color: answer.is_correct ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
              {answer.is_correct ? '已答对' : '需订正'}
            </span>
          );
        }}
        onBack={handleSessionBack}
        onGoToQuestion={goToQuestion}
        showPaperBatch={showPaperBatch}
        onTogglePaperBatch={togglePaperBatch}
        onBatchGraded={(results) => handleBatchGraded(results, isScopeDiagnosticSession)}
        onAnswer={handleAnswer}
        onAnswered={handleAnsweredResult}
        collectMode={isWholeSetSession}
        deferredGrading={isWholeSetSession}
        onCollect={isWholeSetSession ? handleCollectAnswer : undefined}
        getTimeSpentMs={getQuestionTimeSpentMs}
        disabledCurrent={!!answers[session.questions[currentIdx].id]}
        error={error}
        onAllGraded={() => {
          if (isScopeDiagnosticSession) {
            void handleSubmitScopeDiagnostic();
          } else if (isImprovementRetestSession) {
            void handleSubmitImprovementRetest();
          } else {
            handlePracticeComplete();
            setPracticeResultOpen(true);
          }
        }}
        lastAction={isScopeDiagnosticSession ? (
          <button
            type="button"
            onClick={() => {
              if (scopeDiagnosticResult) {
                setPhase('scope_complete');
              } else if (!submittingScopeDiagnostic) {
                void handleSubmitScopeDiagnostic();
              }
            }}
            disabled={!allScopeDiagnosticAnswered || (submittingScopeDiagnostic && !scopeDiagnosticResult)}
            className={[
              'question-workspace-nav-button',
              'question-workspace-nav-button-primary',
              'question-workspace-header-submit',
              allScopeDiagnosticAnswered && (!submittingScopeDiagnostic || scopeDiagnosticResult) ? '' : 'is-disabled',
            ].filter(Boolean).join(' ')}
          >
            {scopeDiagnosticResult
              ? '检测结果'
              : submittingScopeDiagnostic
                ? '正在生成检测结果...'
                : error
                  ? '重新获取检测结果'
                  : '正在生成检测结果...'}
          </button>
        ) : isImprovementRetestSession ? (
          allRetestAnswered ? (
            <button
              type="button"
              onClick={() => {
                if (retestResult) {
                  setSession(null);
                  resetSessionState();
                  setRetestAttemptId(null);
                  setPhase('retest_complete');
                } else if (!retestSubmitting) {
                  void handleSubmitImprovementRetest();
                }
              }}
              disabled={retestSubmitting && !retestResult}
              className={[
                'question-workspace-nav-button',
                'question-workspace-nav-button-primary',
                'question-workspace-header-submit',
                retestSubmitting && !retestResult ? 'is-disabled' : '',
              ].filter(Boolean).join(' ')}
            >
              {retestResult
                ? '复测结果'
                : retestSubmitting
                  ? '正在生成复测结果...'
                  : error
                    ? '重新获取复测结果'
                    : '正在生成复测结果...'}
            </button>
          ) : (
            <span style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>
              答完后可查看复测结果
            </span>
          )
        ) : allPracticeAnswered ? (
          <button
            type="button"
            onClick={() => setPracticeResultOpen(true)}
            className="question-workspace-nav-button question-workspace-nav-button-primary question-workspace-header-submit"
          >
            练习结果
          </button>
        ) : (
          <span style={{ fontSize: 13, color: '#999', alignSelf: 'center' }}>
            答完后可查看练习结果
          </span>
        )}
        incompleteMessage={isScopeDiagnosticSession && !allScopeDiagnosticAnswered && currentIdx === total - 1 ? (
          <div style={{ textAlign: 'right', marginTop: 8, fontSize: 12, color: '#faad14' }}>
            还有题目未作答
          </div>
        ) : null}
      />
      <SessionResultDialog
        open={practiceResultOpen && allPracticeAnswered}
        onClose={() => setPracticeResultOpen(false)}
        title="练习结果"
        scoreText={`得分 ${practiceSummary.correctCount}/${practiceSummary.totalCount} · 得分率 ${Math.round(practiceSummary.accuracy * 100)}%`}
        label={practiceSummary.headline}
        feedback={isImprovementPractice
          ? `${practiceSummary.nextStep.description} 本步提升已记录。`
          : practiceSummary.nextStep.description}
        actions={isImprovementPractice ? (
          <>
            <button type="button" onClick={backToImprovementPlan} className="train-primary-button">
              回到提升路径
            </button>
            <button
              type="button"
              onClick={continueNextImprovementTask}
              disabled={!nextImprovementTask}
              className="train-ghost-button"
            >
              继续下一步
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={resetToEntry} className="train-primary-button">
              换方向继续练
            </button>
          </>
        )}
      />
      </>
    );
  }

  if (phase === 'scope_complete') {
    if (linkedPlanLoading) {
      return (
        <div className="container train-workspace train-complete-panel">
          <div className="loading">加载提升路径...</div>
        </div>
      );
    }

    if (!scopeDiagnosticResult) {
      return (
        <div className="container train-workspace train-error-state">
          <div className="error-banner">检测结果丢失，请返回重新检测</div>
          <button type="button" onClick={handleBackToEntry} className="train-route-secondary-button">返回巩固提升</button>
        </div>
      );
    }

    const colors = scopeDiagnosticResult.recommendation === 'mastered'
      ? { bg: '#f6ffed', border: '#b7eb8f', text: '#389e0d', label: '整体掌握较稳定' }
      : scopeDiagnosticResult.recommendation === 'practice'
        ? { bg: '#fff7e6', border: '#ffd591', text: '#ad6800', label: '有基础，优先补齐薄弱' }
        : { bg: '#f0f5ff', border: '#91caff', text: '#0958d9', label: '建议先回看薄弱知识' };

    return (
      <div className="container train-workspace train-complete-panel">
        {error && <div className="error-banner">{error}</div>}
        {reportLoading && <div className="loading">加载提升报告...</div>}
        {diagnosticReturnAttemptId && (
          <div className="train-footer-actions train-complete-actions">
            <button type="button" onClick={returnToDiagnosticAttempt} className="train-ghost-button">
              回到检测结果
            </button>
          </div>
        )}
        <TrainScopeResultPanel
          result={scopeDiagnosticResult}
          plan={improvementPlan}
          colors={colors}
          onLearnWeak={(kpId) => navigate(`/learn?kp=${kpId}`)}
          onPractice={startImprovementPracticeByKp}
          onStartTask={startImprovementTask}
          onStartRetest={startImprovementRetest}
          onViewReport={improvementPlan ? () => openImprovementReport(improvementPlan.id) : undefined}
          retestLoading={sessionLoading}
          taskJudgments={planTaskJudgments}
          onBack={handleBackToEntry}
          onGoSync={() => navigate('/sync')}
        />
      </div>
    );
  }

  if (phase === 'retest_complete') {
    if (!retestResult) {
      return (
        <div className="container train-workspace train-error-state">
          <div className="error-banner">复测结果丢失，请返回提升路径查看当前状态</div>
          <button type="button" onClick={() => setPhase('scope_complete')} className="train-route-secondary-button">返回提升路径</button>
        </div>
      );
    }

    const backToPlan = () => {
      setPhase('scope_complete');
      setSession(null);
      setRetestAttemptId(null);
      setActiveImprovementTask(null);
      resetSessionState();
    };

    const continueWeak = () => {
      const nextTask = getNextActionableImprovementTask(retestResult.plan);
      if (!nextTask) {
        backToPlan();
        return;
      }
      startImprovementTask(nextTask.id);
    };

    return (
      <div className="container train-workspace train-complete-panel">
        {error && <div className="error-banner">{error}</div>}
        {reportLoading && <div className="loading">加载提升报告...</div>}
        <TrainRetestResultPanel
          result={retestResult}
          onContinueWeak={continueWeak}
          onBackToPlan={backToPlan}
          onBackToEntry={handleBackToEntry}
          onViewReport={() => openImprovementReport(retestResult.plan.id)}
          taskJudgments={retestTaskJudgments}
        />
      </div>
    );
  }

  if (phase === 'learning_trace') {
    return (
      <div className="container train-workspace train-complete-panel">
        {error && <div className="error-banner">{error}</div>}
        {learningTraceLoading && learningTraceItems.length === 0 && (
          <div className="loading">加载学习轨迹...</div>
        )}
        <TrainLearningTracePanel
          items={learningTraceItems}
          total={learningTraceTotal}
          loading={learningTraceLoading}
          onOpenDiagnostic={openDiagnosticAttempt}
          onOpenPlan={(planId) => { void openLinkedImprovementPlan(planId); }}
          onOpenReport={openImprovementReport}
          onLoadMore={() => { void loadLearningTrace(false); }}
          hasMore={learningTraceItems.length < learningTraceTotal}
          onBack={handleBackToEntry}
          backLabel={error ? '返回巩固提升首页' : '返回'}
        />
      </div>
    );
  }

  if (phase === 'diagnostic_history') {
    return (
      <div className="container train-workspace train-complete-panel">
        {error && <div className="error-banner">{error}</div>}
        {diagnosticHistoryLoading && diagnosticHistoryItems.length === 0 && (
          <div className="loading">加载检测历史...</div>
        )}
        <TrainDiagnosticHistoryPanel
          items={diagnosticHistoryItems}
          total={diagnosticHistoryTotal}
          loading={diagnosticHistoryLoading}
          onOpenAttempt={openDiagnosticAttempt}
          onOpenLinkedPlan={(planId) => { void openLinkedImprovementPlan(planId); }}
          onLoadMore={() => { void loadDiagnosticHistory(false); }}
          hasMore={diagnosticHistoryItems.length < diagnosticHistoryTotal}
          onBack={handleBackToEntry}
          backLabel={error ? '返回巩固提升首页' : '返回'}
        />
      </div>
    );
  }

  if (phase === 'diagnostic_attempt') {
    if (!selectedDiagnosticAttempt) {
      return (
        <div className="container train-workspace train-error-state">
          {diagnosticAttemptLoading ? (
            <div className="loading">加载检测结果...</div>
          ) : (
            <div className="error-banner">{error || '检测结果丢失，请返回检测历史重新打开'}</div>
          )}
          <div className="train-footer-actions train-complete-actions">
            <button type="button" onClick={openDiagnosticHistory} className="train-route-secondary-button">
              返回检测历史
            </button>
            <button type="button" onClick={handleBackToEntry} className="train-route-primary-button">
              返回巩固提升首页
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="container train-workspace train-complete-panel">
        {error && <div className="error-banner">{error}</div>}
        <TrainDiagnosticAttemptDetailPanel
          attempt={selectedDiagnosticAttempt}
          loading={diagnosticAttemptLoading || sessionLoading || reportLoading}
          onBackToHistory={openDiagnosticHistory}
          onBackToEntry={handleBackToEntry}
          onViewPlan={openLinkedPlanFromDiagnosticAttempt}
          onViewReport={openImprovementReportFromDiagnosticAttempt}
          onRediagnose={rediagnoseFromAttempt}
        />
      </div>
    );
  }

  if (phase === 'report_history') {
    return (
      <div className="container train-workspace train-complete-panel">
        {error && <div className="error-banner">{error}</div>}
        <TrainImprovementReportHistoryPanel
          items={reportHistoryItems}
          total={reportHistoryTotal}
          loading={reportHistoryLoading}
          onOpenReport={openImprovementReport}
          onLoadMore={() => { void loadReportHistory(false); }}
          hasMore={reportHistoryItems.length < reportHistoryTotal}
          onBack={handleBackToEntry}
          backLabel={error ? '返回巩固提升首页' : '返回'}
        />
      </div>
    );
  }

  if (phase === 'report') {
    if (!improvementReport) {
      return (
        <div className="container train-workspace train-error-state">
          <div className="error-banner">提升报告丢失，请返回巩固提升首页</div>
          <button type="button" onClick={handleBackToEntry} className="train-route-secondary-button">返回巩固提升</button>
        </div>
      );
    }

    const backToPlan = improvementPlan
      ? () => {
        setPhase('scope_complete');
        setSession(null);
        resetSessionState();
      }
      : undefined;
    const startNewDiagnostic = () => {
      navigate('/train');
      void startScopeDiagnostic(improvementReport.summary.scopeType, improvementReport.summary.scopeId);
    };

    return (
      <div className="container train-workspace train-complete-panel train-report-print-shell">
        <TrainImprovementReportPanel
          report={improvementReport}
          onBackToEntry={handleBackToEntry}
          onBackToPlan={backToPlan}
          onStartNewDiagnostic={startNewDiagnostic}
          onBackToDiagnosticAttempt={diagnosticReturnAttemptId ? returnToDiagnosticAttempt : undefined}
          onPrint={() => window.print()}
          onCopySummary={handleCopyReportSummary}
          copyStatus={reportCopyStatus}
        />
      </div>
    );
  }

  return null;
}
