import type { ScopeDiagnosticAttemptDetail } from '../../types';

interface TrainDiagnosticAttemptDetailPanelProps {
  attempt: ScopeDiagnosticAttemptDetail;
  loading?: boolean;
  onBackToHistory: () => void;
  onBackToEntry: () => void;
  onViewPlan?: (planId: string) => void;
  onViewReport?: (planId: string) => void;
  onRediagnose?: (scopeType: 'chapter' | 'section', scopeId: string) => void;
  className?: string;
}

const RECOMMENDATION_LABELS: Record<string, string> = {
  study: '建议回看',
  practice: '建议练习',
  mastered: '整体稳定',
};

const PLAN_STATUS_LABELS: Record<string, string> = {
  diagnosed: '已生成提升路径',
  in_progress: '提升中',
  ready_for_retest: '待阶段复测',
  completed: '已完成提升闭环',
};

function recommendationLabel(value?: string | null): string {
  return value ? RECOMMENDATION_LABELS[value] || value : '仅检测';
}

function planStatusLabel(value?: string | null): string {
  return value ? PLAN_STATUS_LABELS[value] || value : '仅检测';
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function accuracy(correct: number, total: number): string {
  if (total <= 0) return '未记录';
  return `${Math.round((correct / total) * 100)}%`;
}

function dateLabel(value?: string | null): string {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resultFeedback(attempt: ScopeDiagnosticAttemptDetail): string {
  if (attempt.feedback) return attempt.feedback;
  const result = attempt.result;
  if (result && typeof result === 'object' && 'feedback' in result && typeof result.feedback === 'string') {
    return result.feedback;
  }
  return '本次检测结果已记录。';
}

export default function TrainDiagnosticAttemptDetailPanel({
  attempt,
  loading = false,
  onBackToHistory,
  onBackToEntry,
  onViewPlan,
  onViewReport,
  onRediagnose,
  className = '',
}: TrainDiagnosticAttemptDetailPanelProps) {
  const canRediagnose = attempt.scopeType === 'chapter' || attempt.scopeType === 'section';
  const canViewPlan = !!attempt.linkedPlanId && !!onViewPlan;
  const canViewReport = !!attempt.linkedPlanId && attempt.linkedReportAvailable && !!onViewReport;

  return (
    <div className={['card train-complete-card train-diagnostic-detail-panel', className].filter(Boolean).join(' ')}>
      <div className="train-complete-title">检测结果</div>
      <div className="train-complete-score">
        {attempt.scopeName} · 正确 {attempt.correctCount}/{attempt.totalCount}
      </div>

      <div className="train-diagnostic-detail-overview" aria-label="检测结果概览">
        <div className="train-report-metric">
          <span>检测范围</span>
          <strong>{attempt.scopeName}</strong>
          <em>{attempt.scopeType === 'section' ? '小节' : '章节'}</em>
        </div>
        <div className="train-report-metric">
          <span>正确率</span>
          <strong>{accuracy(attempt.correctCount, attempt.totalCount)}</strong>
          <em>{attempt.correctCount}/{attempt.totalCount}</em>
        </div>
        <div className="train-report-metric">
          <span>薄弱点</span>
          <strong>{attempt.weakCount}</strong>
          <em>{recommendationLabel(attempt.recommendation)}</em>
        </div>
        <div className="train-report-metric">
          <span>检测时间</span>
          <strong>{dateLabel(attempt.submittedAt)}</strong>
          <em>{attempt.status}</em>
        </div>
      </div>

      <div className="train-complete-next-step train-diagnostic-feedback">
        <div className="train-complete-next-title">检测反馈</div>
        <div className="train-complete-next-text">{resultFeedback(attempt)}</div>
      </div>

      <div className="train-scope-result-section-title">知识点表现</div>
      <div className="train-diagnostic-kp-list">
        {attempt.kpResults.length === 0 ? (
          <div className="train-diagnostic-empty-state">暂无知识点明细</div>
        ) : (
          attempt.kpResults.map(item => (
            <div className="train-diagnostic-kp-item" key={item.id}>
              <div className="train-diagnostic-kp-main">
                <div>
                  <div className="train-scope-result-kp-name">{item.kpName}</div>
                  {item.groupName && (
                    <div className="train-scope-result-kp-meta">{item.groupName}</div>
                  )}
                  <div className="train-scope-result-kp-meta">
                    正确 {item.correctCount}/{item.totalCount} · 掌握度 {percent(item.masteryBefore)} → {percent(item.masteryAfter)}
                  </div>
                </div>
              </div>
              <span className={['train-diagnostic-kp-status', item.isWeak ? 'is-weak' : ''].filter(Boolean).join(' ')}>
                {item.isWeak ? '薄弱' : '稳定'}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="train-diagnostic-linked-plan">
        <div>
          <div className="train-scope-result-section-title">关联提升路径</div>
          <div className="train-scope-result-kp-meta">
            {attempt.linkedPlanId
              ? `本次检测已关联提升路径：${planStatusLabel(attempt.linkedPlanStatus)}`
              : '本次检测尚未关联提升路径'}
          </div>
        </div>
        {attempt.linkedPlanId && (
          <div className="train-diagnostic-history-actions">
            <button
              type="button"
              onClick={() => onViewPlan?.(attempt.linkedPlanId as string)}
              disabled={!canViewPlan || loading}
              className="train-route-secondary-button"
            >
              查看提升路径
            </button>
            {attempt.linkedReportAvailable && (
              <button
                type="button"
                onClick={() => onViewReport?.(attempt.linkedPlanId as string)}
                disabled={!canViewReport || loading}
                className="train-route-primary-button"
              >
                查看提升报告
              </button>
            )}
          </div>
        )}
      </div>

      <div className="train-footer-actions train-complete-actions">
        <button type="button" onClick={onBackToHistory} className="train-primary-button">
          返回检测历史
        </button>
        <button type="button" onClick={onBackToEntry} className="train-ghost-button">
          回到巩固提升首页
        </button>
        {canRediagnose && onRediagnose && (
          <button
            type="button"
            onClick={() => onRediagnose(attempt.scopeType, attempt.scopeId)}
            disabled={loading}
            className="train-ghost-button"
          >
            重新检测
          </button>
        )}
      </div>
    </div>
  );
}
