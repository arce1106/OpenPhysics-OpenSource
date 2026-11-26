interface ReviewEmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export default function ReviewEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
}: ReviewEmptyStateProps) {
  return (
    <div className={['card review-empty-state', className].filter(Boolean).join(' ')}>
      <div className="review-empty-title">{title}</div>
      {description && <div className="review-empty-text">{description}</div>}
      {(actionLabel || secondaryActionLabel) && (
        <div className="review-empty-actions">
          {actionLabel && onAction && (
            <button type="button" className="page-back-button" onClick={onAction}>
              {actionLabel}
            </button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <button type="button" className="page-back-button" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
