import { DIFFICULTY_LABELS, typeLabel } from './labels';
import type { AssignmentItem } from './types';

// Rough minutes a typical student needs per question, by type.
const MINUTES_BY_TYPE: Record<string, number> = {
  single_choice: 2,
  multiple_choice: 3,
  true_false: 1,
  fill_in_blank: 3,
  knowledge_fill_in_blank: 2,
  experiment: 8,
  graph_construction: 8,
  problem_solving: 12,
  comprehensive: 15,
};
const DEFAULT_MINUTES = 6;

export interface BlueprintRow {
  label: string;
  count: number;
  points: number;
}

export interface Blueprint {
  questionCount: number;
  totalPoints: number;
  minutes: number;
  byType: BlueprintRow[];
  byDifficulty: BlueprintRow[];
  byKnowledgePoint: BlueprintRow[];
}

function tally(rows: Map<string, BlueprintRow>, label: string, points: number) {
  const row = rows.get(label) || { label, count: 0, points: 0 };
  row.count += 1;
  row.points += points;
  rows.set(label, row);
}

export function buildBlueprint(items: AssignmentItem[]): Blueprint {
  const byType = new Map<string, BlueprintRow>();
  const byDifficulty = new Map<string, BlueprintRow>();
  const byKnowledgePoint = new Map<string, BlueprintRow>();
  let minutes = 0;
  let totalPoints = 0;
  for (const item of items) {
    const question = item.question;
    totalPoints += item.points;
    minutes += MINUTES_BY_TYPE[question?.question_type || ''] ?? DEFAULT_MINUTES;
    tally(byType, typeLabel(question?.question_type ?? null), item.points);
    tally(byDifficulty, DIFFICULTY_LABELS[question?.difficulty_tier || ''] || '未定', item.points);
    tally(byKnowledgePoint, question?.primary_kp?.name || '未标注知识点', item.points);
  }
  const difficultyOrder = [...Object.values(DIFFICULTY_LABELS), '未定'];
  return {
    questionCount: items.length,
    totalPoints,
    minutes,
    byType: [...byType.values()],
    byDifficulty: [...byDifficulty.values()].sort(
      (a, b) => difficultyOrder.indexOf(a.label) - difficultyOrder.indexOf(b.label),
    ),
    byKnowledgePoint: [...byKnowledgePoint.values()].sort((a, b) => b.points - a.points),
  };
}
