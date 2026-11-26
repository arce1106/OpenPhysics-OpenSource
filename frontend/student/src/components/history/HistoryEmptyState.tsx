interface HistoryEmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export default function HistoryEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  className,
}: HistoryEmptyStateProps) {
  return (
    <div className={`empty-state history-empty-state${className ? ` ${className}` : ''}`}>
      <div className="history-empty-title">{title}</div>
      {description && <div className="history-empty-text">{description}</div>}
      {actionLabel && onAction && (
        <button type="button" className="history-empty-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
