/// <reference types="vite/client" />

type OpenPhysicsStudentBuildInfo = {
  commit: string;
  buildTime: string;
  mode: string;
};

interface Window {
  __OPENPHYSICS_STUDENT_BUILD_INFO__?: OpenPhysicsStudentBuildInfo;
}
