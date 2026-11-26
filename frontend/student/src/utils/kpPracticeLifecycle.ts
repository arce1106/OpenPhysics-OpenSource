import { loadPracticeRecord, type PracticeRecord } from './practicePersistence';

export function hasCompletedQuestionSet(record: PracticeRecord | null): boolean {
  const questions = (record?.payload.session as { questions?: { id: string }[] } | undefined)?.questions;
  return !!questions?.length && questions.every(question => !!record?.answers[question.id]);
}

export function hasCompletedKpAssessment(record: PracticeRecord | null): boolean {
  return hasCompletedQuestionSet(record) && !!record?.payload.diagnosticResult;
}

// The sync entry uses this same scope for every knowledge point. Keep the
// existing key so installed browsers retain their unfinished assessments.
export function loadSyncAssessment(studentId: string, kpId: string): PracticeRecord | null {
  const params = new URLSearchParams({ kp: kpId, count: '3', mode: 'check' });
  return loadPracticeRecord(studentId, `kp-check:${params}`);
}

export function hasKpQuestionSet(record: PracticeRecord | null): boolean {
  return !!(record?.payload.session as { questions?: unknown[] } | undefined)?.questions?.length;
}
