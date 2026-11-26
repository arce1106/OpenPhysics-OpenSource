import type { DirectoryKpNode, StudentProfile } from '../types';

export const ACCOUNT_REQUIRED_MESSAGE = '账号不可用，请重新登录或联系部署管理员。';

export function isLearningAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : error;
  return message === 'Student account unavailable' || message === ACCOUNT_REQUIRED_MESSAGE;
}

export function hasLearningAccess(profile: StudentProfile | null | undefined): boolean {
  return !!profile && (!profile.status || profile.status === 'active');
}

export const canReadLearningHistory = hasLearningAccess;
export const canEnterLearningArea = hasLearningAccess;

export function hasKpContent(kp: Pick<DirectoryKpNode, 'status' | 'content_available'> | null | undefined): boolean {
  return !!kp && kp.status !== 'pending_content' && kp.content_available !== false;
}

export function hasKpPractice(kp: Pick<DirectoryKpNode, 'status' | 'practice_available'> | null | undefined): boolean {
  return !!kp && kp.status !== 'pending_content' && kp.practice_available !== false;
}

export function canAccessKp(
  profile: StudentProfile | null | undefined,
  _kp: Pick<DirectoryKpNode, 'volume' | 'chapter' | 'section'> | null | undefined,
): boolean {
  return hasLearningAccess(profile);
}
