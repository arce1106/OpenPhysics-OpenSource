import type { ScopeDiagnosticAttemptListItem } from '../../types';

interface TrainDiagnosticHistoryPanelProps {
  items: ScopeDiagnosticAttemptListItem[];
  total: number;
  loading?: boolean;
  onOpenAttempt: (attemptId: string) => void;
  onOpenLinkedPlan?: (planId: string) => void;
  onBack: () => void;
  backLabel?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
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

export default function TrainDiagnosticHistoryPanel({
  items,
  total,
  loading = false,
  onOpenAttempt,
  onOpenLinkedPlan,
  onBack,
  backLabel = '返回',
  onLoadMore,
  hasMore = false,
  className = '',
}: TrainDiagnosticHistoryPanelProps) {
  return (
    <div className={['train-diagnostic-history-panel', className].filter(Boolean).join(' ')}>
      <div className="card train-complete-card train-diagnostic-history-header-card">
        <div className="train-diagnostic-history-header">
          <button type="button" onClick={onBack} className="page-back-button train-subpage-back-button">
            {backLabel}
          </button>
          <div className="train-complete-title">检测历史</div>
        </div>
        <div className="train-complete-score">查看每次章节 / 单元检测结果，回顾薄弱点和对应提升路径。</div>
      </div>

      <div className="card train-complete-card train-diagnostic-history-records-panel">
        {items.length === 0 ? (
          <div className="train-diagnostic-empty-state">
            <div>暂无检测记录</div>
            <p>完成一次章节或单元检测后，会在这里生成历史记录。</p>
          </div>
        ) : (
          <div className="train-diagnostic-history-list" aria-label="检测历史列表">
            {items.map(item => {
              const hasLinkedPlan = !!item.linkedPlanId && !!onOpenLinkedPlan;
              const actionLabel = hasLinkedPlan
                ? `查看${item.scopeName}提升路径`
                : `查看${item.scopeName}检测记录`;
              const eyebrowLabel = hasLinkedPlan ? '对应提升路径' : '检测记录';

              return (
                <button
                  type="button"
                  className="train-diagnostic-history-item"
                  key={item.attemptId}
                  onClick={() => {
                    if (hasLinkedPlan) {
                      onOpenLinkedPlan(item.linkedPlanId as string);
                      return;
                    }
                    onOpenAttempt(item.attemptId);
                  }}
                  aria-label={actionLabel}
                >
                  <div className="train-diagnostic-history-main">
                    <div className="train-route-eyebrow">{eyebrowLabel}</div>
                    <div className="train-diagnostic-history-title">{item.scopeName}</div>
                    <div className="train-diagnostic-history-meta">
                      <span>{dateLabel(item.submittedAt || item.createdAt)}</span>
                      <span>正确 {item.correctCount}/{item.totalCount}</span>
                      <span>薄弱点 {item.weakCount} 个</span>
                    </div>
                    {item.feedback && (
                      <div className="train-diagnostic-history-feedback">{item.feedback}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {hasMore && onLoadMore && (
          <div className="train-footer-actions train-complete-actions">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loading}
              className="train-primary-button"
            >
              {loading ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}

        {items.length > 0 && (
          <div className="train-report-history-total">
            已显示 {items.length}/{total}
          </div>
        )}
      </div>
    </div>
  );
}
