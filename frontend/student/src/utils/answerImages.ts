import type { ProcessGrading } from '../types';

function normalizePaths(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter(path => typeof path === 'string' && path.trim().length > 0);
  }
  return typeof value === 'string' && value.trim().length > 0 ? [value] : [];
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

export function getProcessAnswerImagePaths(grading?: ProcessGrading | null): string[] {
  if (!grading) return [];

  const answerImagePaths = uniquePaths(normalizePaths(grading.answer_image_paths));
  if (answerImagePaths.length > 0) return answerImagePaths;

  const answerImagePath = uniquePaths(normalizePaths(grading.answer_image_path));
  if (answerImagePath.length > 0) return answerImagePath;

  return uniquePaths([
    ...normalizePaths(grading.answer_crop_image_path),
    ...normalizePaths(grading.answer_page_image_paths),
    ...normalizePaths(grading.answer_page_image_path),
    ...normalizePaths(grading.process_evidence_image_path),
  ]);
}
