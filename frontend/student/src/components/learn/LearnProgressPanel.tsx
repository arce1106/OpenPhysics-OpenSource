interface LearnProgressItem {
  consumed: number;
  total: number;
}

interface LearnProgressPanelProps {
  progress: Record<string, LearnProgressItem>;
  className?: string;
}

export default function LearnProgressPanel({
  progress,
  className = '',
}: LearnProgressPanelProps) {
  const entries = Object.entries(progress);
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, [, item]) => sum + item.total, 0);
  const consumed = entries.reduce((sum, [, item]) => sum + item.consumed, 0);
  const percent = total > 0 ? Math.min(100, Math.max(0, (consumed / total) * 100)) : 0;

  return (
    <div className={['learn-progress-panel', className].filter(Boolean).join(' ')}>
      <div className="learn-progress-head">
        <span className="learn-progress-title">学习进度</span>
        <span className="learn-progress-summary">{consumed}/{total}</span>
      </div>
      <div className="learn-progress-track">
        <div className="learn-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
