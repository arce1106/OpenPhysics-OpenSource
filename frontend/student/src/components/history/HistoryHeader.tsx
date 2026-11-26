import type { ReactNode } from 'react';

interface HistoryHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ReactNode;
  className?: string;
}

export default function HistoryHeader({
  title,
  subtitle,
  onBack,
  actions,
  className,
}: HistoryHeaderProps) {
  return (
    <div className={`page-header-actions history-header${className ? ` ${className}` : ''}`}>
      <div>
        {onBack && (
          <button type="button" className="page-back-button" onClick={onBack}>
            返回
          </button>
        )}
        <h1 className="history-header-title">{title}</h1>
        {subtitle && <p className="history-header-subtitle">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
