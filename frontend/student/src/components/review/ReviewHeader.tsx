import type { ReactNode } from 'react';

interface ReviewHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
}

export default function ReviewHeader({
  title,
  subtitle,
  actions,
  onBack,
  backLabel = '返回',
  className = '',
}: ReviewHeaderProps) {
  return (
    <div className={['page-header page-header-actions review-header review-header-panel', className].filter(Boolean).join(' ')}>
      <div className="review-header-copy">
        {onBack && (
          <button type="button" className="page-back-button review-header-back" onClick={onBack}>
            {backLabel}
          </button>
        )}
        <h1 className="review-header-title">{title}</h1>
        {subtitle && <p className="review-header-subtitle">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
