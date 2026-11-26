import { percent } from '../labels';
import type { PerformanceLevel } from '../types';

/**
 * One performance figure everywhere, with how many questions it rests on. Homework is read as
 * marked (points earned / points available); practice has no points, so each answer counts as one
 * question at its partial credit. Too few questions read as 数据不足, never as a percentage.
 */
export const LEVEL_LABELS: Record<PerformanceLevel, string> = {
  weak: '薄弱', developing: '待巩固', mastered: '已掌握', insufficient: '数据不足',
};
const RANK: Record<PerformanceLevel, number> = { weak: 0, developing: 1, mastered: 2, insufficient: 3 };

export function levelRank(level: PerformanceLevel | undefined) { return RANK[level ?? 'insufficient']; }

export function LevelTag({ level }: { level?: PerformanceLevel }) {
  const value = level ?? 'insufficient';
  return <span className={`level-tag level-${value}`}>{LEVEL_LABELS[value]}</span>;
}

export function Performance({ score, evidence, level }: { score?: number | null; evidence?: number; level?: PerformanceLevel }) {
  const count = evidence ?? 0;
  if (!count) return <span className="muted">—</span>;
  return <span className="performance">
    {level === 'insufficient' || score == null ? <span className="muted">数据不足</span> : <strong>{percent(score)}</strong>}
    <span className="performance-basis">依据 {count} 题</span>
  </span>;
}

export const PERFORMANCE_NOTE = '表现：已发布作业按卷面分值计（总得分 / 总满分，分值大的题和试卷影响更大），'
  + '自主练习没有分值，按题计、部分得分折算；两者按题数合并。不足 3 题时显示“数据不足”。'
  + '85% 及以上为已掌握，60%–85% 为待巩固，低于 60% 为薄弱。';
