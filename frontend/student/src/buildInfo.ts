export type StudentBuildInfo = {
  commit: string;
  buildTime: string;
  mode: string;
};

export const STUDENT_BUILD_INFO: StudentBuildInfo = {
  commit: import.meta.env.VITE_GIT_COMMIT || 'dev',
  buildTime: import.meta.env.VITE_BUILD_TIME || '',
  mode: import.meta.env.MODE || '',
};

export function exposeStudentBuildInfo(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.__OPENPHYSICS_STUDENT_BUILD_INFO__ = STUDENT_BUILD_INFO;
  console.info('[OpenPhysics Student]', STUDENT_BUILD_INFO);
}
