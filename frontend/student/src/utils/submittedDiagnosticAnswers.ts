import type { SubmitResult, SubmittedDiagnosticAnswer } from '../types';

export function buildSubmittedDiagnosticAnswers(
  answers: Record<string, SubmitResult>,
): SubmittedDiagnosticAnswer[] {
  return Object.values(answers).map(answer => {
    if (!answer.answer_id) {
      throw new Error('评估记录不完整，请先提交批改');
    }
    return {
      answer_id: answer.answer_id,
      mastery_update: answer.mastery_update || {},
    };
  });
}
