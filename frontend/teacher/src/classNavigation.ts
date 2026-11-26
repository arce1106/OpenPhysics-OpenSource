/** Keep the teacher's class-list context when drilling into a student. */
export interface ClassListFilters {
  search: string;
  status: string;
  sort: string;
  chapter: string;
}

export interface StudentNavigationState {
  returnTo: string;
  classFilters: ClassListFilters;
}

export function studentLearningPath(classId: string, studentId: string) {
  return `/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`;
}

export function studentReturnContext(classId: string, state: unknown): StudentNavigationState {
  const candidate = state as Partial<StudentNavigationState> | null;
  const base = `/classes/${encodeURIComponent(classId)}`;
  const valid = typeof candidate?.returnTo === 'string' && candidate.returnTo.split('?')[0] === base;
  const values = valid ? candidate?.classFilters : undefined;
  return {
    returnTo: valid ? candidate!.returnTo! : `${base}?view=students`,
    classFilters: {
      search: typeof values?.search === 'string' ? values.search : '',
      status: typeof values?.status === 'string' ? values.status : 'all',
      sort: typeof values?.sort === 'string' ? values.sort : 'attention',
      chapter: typeof values?.chapter === 'string' ? values.chapter : '',
    },
  };
}
