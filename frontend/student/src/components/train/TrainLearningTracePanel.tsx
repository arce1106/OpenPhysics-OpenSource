import type { LearningTraceEvent } from '../../types';

interface TrainLearningTracePanelProps {
  items: LearningTraceEvent[];
  total: number;
  loading?: boolean;
  onOpenDiagnostic: (attemptId: string) => void;
  onOpenPlan: (planId: string) => void;
  onOpenReport: (planId: string) => void;
  onBack: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  backLabel?: string;
  className?: string;
}

function dateLabel(value?: string | null): string {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function scopeLabel(event: LearningTraceEvent): string {
  if (!event.scopeName) return '全部范围';
  return `${event.scopeType === 'section' ? '小节' : '章节'} · ${event.scopeName}`;
}

function actionForEvent(
  event: LearningTraceEvent,
  onOpenDiagnostic: (attemptId: string) => void,
  onOpenPlan: (planId: string) => void,
  onOpenReport: (planId: string) => void,
) {
  if (event.primaryAction === 'view_diagnostic' && event.attemptId) {
    return {
      label: '查看检测结果',
      onClick: () => onOpenDiagnostic(event.attemptId as string),
      primary: false,
    };
  }
  if (event.primaryAction === 'view_report' && event.planId) {
    return {
      label: '查看提升报告',
      onClick: () => onOpenReport(event.planId as string),
      primary: true,
    };
  }
  if (event.primaryAction === 'view_plan' && event.planId) {
    return {
      label: '查看提升路径',
      onClick: () => onOpenPlan(event.planId as string),
      primary: false,
    };
  }
  return null;
}

export default function TrainLearningTracePanel({
  items,
  total,
  loading = false,
  onOpenDiagnostic,
  onOpenPlan,
  onOpenReport,
  onBack,
  onLoadMore,
  hasMore = false,
  backLabel = '返回',
  className = '',
}: TrainLearningTracePanelProps) {
  return (
    <div className={['card train-complete-card train-learning-trace-panel', className].filter(Boolean).join(' ')}>
      <div className="train-complete-title">学习轨迹</div>
      <div className="train-complete-score">按时间回顾你的检测、提升、复测和报告记录。</div>

      {items.length === 0 ? (
        <div className="train-learning-trace-empty">
          <div>暂无学习轨迹</div>
          <p>完成一次检测、提升或复测后，会在这里生成时间线。</p>
        </div>
      ) : (
        <div className="train-learning-trace-list" aria-label="学习轨迹列表">
          {items.map(event => {
            const action = actionForEvent(event, onOpenDiagnostic, onOpenPlan, onOpenReport);
            return (
              <div className="train-learning-trace-item" key={event.id}>
                <div className="train-learning-trace-marker" aria-hidden="true" />
                <div className="train-learning-trace-main">
                  <div className="train-learning-trace-topline">
                    <span className="train-route-eyebrow">{event.statusLabel || event.eventType}</span>
                    <span>{dateLabel(event.eventTime)}</span>
                  </div>
                  <div className="train-learning-trace-title">{event.title}</div>
                  <div className="train-learning-trace-meta">
                    <span>{scopeLabel(event)}</span>
                    {event.kpName && <span>{event.kpName}</span>}
                  </div>
                  <div className="train-learning-trace-description">{event.description}</div>
                </div>
                {action && (
                  <button
                    type="button"
                    onClick={action.onClick}
                    className={action.primary ? 'train-route-primary-button' : 'train-route-secondary-button'}
                  >
                    {action.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="train-footer-actions train-complete-actions">
        {hasMore && onLoadMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="train-primary-button"
          >
            {loading ? '加载中...' : '加载更多'}
          </button>
        )}
        <button type="button" onClick={onBack} className="train-ghost-button">
          {backLabel}
        </button>
      </div>

      {items.length > 0 && (
        <div className="train-report-history-total">
          已显示 {items.length}/{total}
        </div>
      )}
    </div>
  );
}
