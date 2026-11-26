import type { ProcessGrading, SubmitResult } from '../types';

export function processScoreLabel(grading: ProcessGrading): string {
  if (grading.process_score == null) return '';
  const percent = grading.process_score_percent ?? grading.process_score;
  if (grading.score != null && grading.max_score != null) {
    return `${grading.score}/${grading.max_score} 分 · 折合 ${percent}/100`;
  }
  return `${grading.process_score}/100`;
}

export function resultCredit(answer: Pick<SubmitResult, 'is_correct' | 'process_grading'>): number {
  const grading = answer.process_grading;
  if (typeof grading?.score === 'number' && typeof grading.max_score === 'number' && grading.max_score > 0) {
    return clampCredit(grading.score / grading.max_score);
  }
  const processScore = answer.process_grading?.process_score;
  if (typeof processScore === 'number') {
    return clampCredit(processScore / 100);
  }

  const stepScores = answer.process_grading?.step_scores || [];
  const maxScore = stepScores.reduce((sum, step) => sum + (step.max_score || 0), 0);
  if (maxScore > 0) {
    const score = stepScores.reduce((sum, step) => sum + (step.score || 0), 0);
    return clampCredit(score / maxScore);
  }

  return answer.is_correct ? 1 : 0;
}

export function totalResultCredit(answers: Array<Pick<SubmitResult, 'is_correct' | 'process_grading'>>) {
  return displayCredit(answers.reduce((sum, answer) => sum + resultCredit(answer), 0));
}

export function displayCredit(value: number) {
  return Number.isInteger(value) ? value : Number(value.toFixed(1));
}

function clampCredit(value: number) {
  return Math.max(0, Math.min(1, value));
}
