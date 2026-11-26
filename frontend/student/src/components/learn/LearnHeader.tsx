import type { ReactNode } from 'react';

interface LearnHeaderProps {
  title: string;
  subtitle?: string;
  meta?: string;
  onBack: () => void;
  aside?: ReactNode;
  className?: string;
}

export default function LearnHeader({
  title,
  subtitle,
  meta,
  onBack,
  aside,
  className = '',
}: LearnHeaderProps) {
  return (
    <div className={['learn-header learn-header-panel', className].filter(Boolean).join(' ')}>
      <button
        onClick={onBack}
        className="learn-back-button"
      >
        返回
      </button>
      <div className="learn-header-main">
        <div className="learn-title-block learn-header-title">
          {title}
        </div>
        {(subtitle || meta) && (
          <div className="learn-header-meta">
            {subtitle || meta}
          </div>
        )}
      </div>
      {aside ? (
        <div className="learn-header-aside">
          {aside}
        </div>
      ) : (
        <div className="learn-header-spacer" />
      )}
    </div>
  );
}
