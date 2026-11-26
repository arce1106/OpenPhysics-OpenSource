import type { TeacherHomework, TeacherPaper } from '../types';

export interface HomeworkScore {
  percent: number;
  label: string;
  note: string;
}

/** A finished homework's score out of 100. Until released it is the app's own grading. */
export function homeworkScore(item: Pick<TeacherPaper | TeacherHomework, 'score_percent' | 'results_released'>): HomeworkScore | null {
  if (item.score_percent == null) return null;
  return {
    percent: item.score_percent,
    label: `${item.score_percent} 分`,
    note: item.results_released ? '老师已审核' : 'AI 批改，老师审核后可能调整',
  };
}

/**
 * The home card shows one homework: the newest unfinished one, otherwise the newest finished one.
 * Older finished homework is reopened from 作业记录; other unfinished ones fold under the first.
 * The server lists homework newest first.
 */
export function homeTeacherHomework(items: TeacherHomework[]) {
  const pending = items.filter((item) => item.status !== 'completed');
  const primary = pending[0] ?? items[0] ?? null;
  return { primary, otherPending: pending.filter((item) => item !== primary) };
}

export function homeworkDetail(item: TeacherHomework): string {
  if (item.status === 'grading') return `${item.class_name} · 已批改 ${item.graded_count}/${item.question_count}`;
  const count = `${item.class_name} · ${item.question_count} 题`;
  return item.status === 'completed' ? `${count} · ${homeworkScore(item)?.label ?? '已完成'}` : count;
}

/** What a record row says on the right: the score once finished, otherwise where it stands. */
export function homeworkRecordStatus(item: TeacherHomework): { status: string; note: string } {
  if (item.status === 'grading') return { status: '批改中', note: `已批改 ${item.graded_count}/${item.question_count}` };
  if (item.status !== 'completed') return { status: '未完成', note: `${item.question_count} 题` };
  const score = homeworkScore(item);
  return score ? { status: score.label, note: score.note } : { status: '已完成', note: '' };
}

export function homeworkRecordMeta(item: TeacherHomework): string {
  return [
    item.class_name,
    item.delivery === 'paper' ? '纸质作业' : `${item.question_count} 题`,
    item.published_at && item.published_at.length >= 10 ? `布置于 ${item.published_at.slice(0, 10)}` : '',
  ].filter(Boolean).join(' · ');
}

/** The mean out of 100 of the homework that has a score; null when none has. */
export function homeworkAverage(items: TeacherHomework[]): number | null {
  const scores = items.flatMap((item) => item.score_percent ?? []);
  return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
}
