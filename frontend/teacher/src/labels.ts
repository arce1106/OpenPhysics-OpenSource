import type { ClassLevel } from './types';

export const CLASS_LEVEL_LABELS: Record<ClassLevel, string> = {
  advanced: '实验班',
  standard: '普通班',
  foundation: '基础班',
};

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatPoints(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export const QUESTION_TYPE_LABELS: Record<string, string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
  fill_in_blank: '填空题',
  knowledge_fill_in_blank: '知识填空',
  experiment: '实验题',
  graph_construction: '作图题',
  problem_solving: '计算题',
  comprehensive: '综合题',
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '易',
  moderate_easy: '较易',
  medium: '中等',
  moderate_hard: '较难',
  hard: '难',
};

export const BOX_LABELS: Record<string, string> = {
  small: '小框',
  medium: '中框',
  large: '大框',
};

export function typeLabel(type: string | null): string {
  return (type && QUESTION_TYPE_LABELS[type]) || '其他';
}

export function tierLabel(tier: string | null): string {
  return (tier && DIFFICULTY_LABELS[tier]) || '未定';
}

export const KIND_LABELS: Record<string, string> = {
  test: '测验',
  personalized: '个性化作业',
};

/** Where one class's copy stands, in the words of the next thing to do. */
export function classProgress(row: {
  status: string; delivery?: 'app' | 'paper' | null; paper_students?: number; results_released_at?: string | null; collected: number; member_count: number;
}): string {
  if (row.status === 'draft') return '待审核发布';
  if (row.results_released_at) return '已发布结果';
  if (row.collected > 0) return `已收 ${row.collected}/${row.member_count} · 待发布结果`;
  if (row.delivery === 'app') return row.paper_students ? `待作答 · ${row.paper_students} 份纸质待收` : '待作答';
  return '待收卷';
}

/** "10/21": short enough to tell two copies of the same homework apart. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}/${date.getDate()}`;
}
