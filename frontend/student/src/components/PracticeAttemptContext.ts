import type { TopicPracticeContext } from '../types';
import { createContext } from 'react';
export const PracticeAttemptContext = createContext<string | undefined>(undefined);
export function optionalAttemptScope(scope: string | undefined): [
] | [
  string
] {
  return scope ? [scope] : [];
}

export const TeacherPaperAttemptContext = createContext<{
  id: string;
  beforeSubmit?: () => Promise<void>;
} | undefined>(undefined);

export const TopicSubmissionContext = createContext<TopicPracticeContext | undefined>(undefined);

export function optionalPaperSubmissionScope(scope: string | undefined, paperId?: string, topic?: TopicPracticeContext): [string?, string?, TopicPracticeContext?] {
  if (topic) return [scope, paperId, topic];
  return paperId ? [scope, paperId] : optionalAttemptScope(scope);
}
