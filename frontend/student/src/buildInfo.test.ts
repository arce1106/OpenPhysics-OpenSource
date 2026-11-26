import { describe, expect, it, vi } from 'vitest';

import { exposeStudentBuildInfo, STUDENT_BUILD_INFO } from './buildInfo';

describe('student build info', () => {
  it('exposes the student build info on window and prints one console line', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    delete window.__OPENPHYSICS_STUDENT_BUILD_INFO__;

    exposeStudentBuildInfo();

    expect(window.__OPENPHYSICS_STUDENT_BUILD_INFO__).toBe(STUDENT_BUILD_INFO);
    expect(window.__OPENPHYSICS_STUDENT_BUILD_INFO__).toMatchObject({
      commit: expect.any(String),
      buildTime: expect.any(String),
      mode: expect.any(String),
    });
    expect(infoSpy).toHaveBeenCalledWith('[OpenPhysics Student]', STUDENT_BUILD_INFO);

    infoSpy.mockRestore();
  });
});
