import type { ScopeDiagnosticResult } from '../types';

export function pickNextKpFromScopeResult(result: ScopeDiagnosticResult): string | null {
  const firstWeakKpId = result.weak_kp_ids[0];
  if (firstWeakKpId) return firstWeakKpId;

  let lowestMasteryKpId: string | null = null;
  let lowestMastery: number | null = null;
  for (const item of result.kp_results) {
    if (!item.kp_id) continue;
    if (lowestMastery === null || item.mastery_after < lowestMastery) {
      lowestMastery = item.mastery_after;
      lowestMasteryKpId = item.kp_id;
    }
  }
  return lowestMasteryKpId;
}
