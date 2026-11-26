import { api } from '../api/client';
import type { HandwritingSnapshot } from '../components/handwriting/HandwritingCanvas';
import type { SubmitResult } from '../types';
import { handwritingSnapshotToFile } from './handwritingExport';

export function hasHandwritingEvidence(snapshot?: HandwritingSnapshot | null) {
  return !!snapshot?.strokes?.length;
}

export function shouldAttachChoiceProcessEvidence(
  result: SubmitResult,
  snapshot?: HandwritingSnapshot | null,
) {
  return result.is_correct === false && !!result.answer_id && hasHandwritingEvidence(snapshot);
}

export async function attachHandwritingProcessEvidence(
  result: SubmitResult,
  questionId: string,
  snapshot: HandwritingSnapshot | null | undefined,
  timeSpentMs: number = 0,
): Promise<SubmitResult> {
  if (!shouldAttachChoiceProcessEvidence(result, snapshot)) return result;
  const answerId = result.answer_id;
  if (!answerId || !snapshot) return result;
  const ownerToken = localStorage.getItem('openphysics.student_token');
  const file = await handwritingSnapshotToFile(snapshot, `process-evidence-${questionId}.png`);
  if (localStorage.getItem('openphysics.student_token') !== ownerToken) return result;
  const evidence = await api.submitProcessEvidence(
    answerId,
    questionId,
    file,
    timeSpentMs,
  );
  return {
    ...result,
    process_grading: evidence.process_grading || result.process_grading,
  };
}
