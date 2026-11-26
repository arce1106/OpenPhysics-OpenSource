import type { ImprovementReportListItem } from '../../types';

interface TrainImprovementReportHistoryPanelProps {
  items: ImprovementReportListItem[];
  total: number;
  loading?: boolean;
  onOpenReport: (planId: string) => void;
  onBack?: () => void;
  backLabel?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  className?: string;
}

function percent(value?: number | null): string {
  if (value === null || value === undefined) return '未完成';
  return `${Math.round(value * 100)}%`;
}

function dateLabel(value?: string | null): string {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function TrainImprovementReportHistoryPanel({
  items,
  total,
  loading = false,
  onOpenReport,
  onBack,
  backLabel = '返回',
  onLoadMore,
  hasMore = false,
  className = '',
}: TrainImprovementReportHistoryPanelProps) {
  return (
    <div className={['card train-complete-card train-report-history-panel', className].filter(Boolean).join(' ')}>
      <div className="train-complete-title">提升报告历史</div>
      <div className="train-complete-score">查看已经完成的章节 / 单元提升闭环</div>

      {items.length === 0 ? (
        <div className="train-report-history-empty">
          <div>暂无提升报告</div>
          <p>完成一次阶段复测后，会在这里生成报告。</p>
        </div>
      ) : (
        <div className="train-report-history-list" aria-label="提升报告历史列表">
          {items.map(item => (
            <div className="train-report-history-item" key={item.planId}>
              <div className="train-report-history-main">
                <div className="train-route-eyebrow">{item.summaryLabel}</div>
                <div className="train-report-history-title">{item.scopeName}</div>
                <div className="train-scope-result-kp-meta">
                  完成于 {dateLabel(item.completedAt)} · 检测 {item.diagnosticCorrectCount}/{item.diagnosticTotalCount}
                </div>
                <div className="train-report-history-highlight">{item.highlight}</div>
              </div>
              <div className="train-report-history-stats">
                <div>
                  <span>提升任务</span>
                  <strong>{item.passedTaskCount}/{item.taskCount}</strong>
                </div>
                <div>
                  <span>复测正确率</span>
                  <strong>{percent(item.latestRetestAccuracy)}</strong>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenReport(item.planId)}
                className="train-route-primary-button"
              >
                查看报告
              </button>
            </div>
          ))}
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
        {onBack && (
          <button type="button" onClick={onBack} className="train-ghost-button">
            {backLabel}
          </button>
        )}
      </div>
      {items.length > 0 && (
        <div className="train-report-history-total">
          已显示 {items.length}/{total}
        </div>
      )}
    </div>
  );
}
