interface TrainHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  className?: string;
}

export default function TrainHeader({
  title,
  subtitle,
  onBack,
  className = '',
}: TrainHeaderProps) {
  return (
    <div className={['page-header train-header train-header-panel', className].filter(Boolean).join(' ')}>
      {onBack && (
        <button type="button" className="train-header-back" onClick={onBack}>
          返回
        </button>
      )}
      <div className="train-title-block">
        <h1 className="train-header-title">{title}</h1>
        {subtitle && <p className="train-header-subtitle">{subtitle}</p>}
      </div>
    </div>
  );
}
