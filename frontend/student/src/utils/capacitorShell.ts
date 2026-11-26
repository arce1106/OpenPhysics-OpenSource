declare global {
  interface Window {
    Capacitor?: {
      Plugins?: Record<string, unknown>;
    };
  }
}

export function isCapacitorShell(): boolean {
  return typeof window !== 'undefined' && typeof window.Capacitor !== 'undefined';
}

export function shouldHideStudentWebNav(pathname: string): boolean {
  if (!isCapacitorShell()) return false;
  const normalizedPath = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  return !(
    normalizedPath === '/login'
    || normalizedPath === '/register'
    || normalizedPath.startsWith('/legal/')
    || normalizedPath === '/question-pane'
  );
}
