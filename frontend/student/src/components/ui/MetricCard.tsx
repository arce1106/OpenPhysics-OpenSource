type MetricCardTone = 'default' | 'primary' | 'success' | 'warning' | 'danger';

export interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: MetricCardTone;
  className?: string;
}

export default function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
  className = '',
}: MetricCardProps) {
  const classes = ['op-metric-card', `op-metric-card--${tone}`, className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <span className="op-metric-card__label">{label}</span>
      <strong className="op-metric-card__value">{value}</strong>
      {hint && <p className="op-metric-card__hint">{hint}</p>}
    </div>
  );
}
