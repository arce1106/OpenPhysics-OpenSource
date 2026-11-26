export const loadSyncPage = () => import('../pages/SyncPage');
export const loadTrainPage = () => import('../pages/TrainPage');
export const loadReviewPage = () => import('../pages/ReviewPage');
export const loadGaokaoReviewPage = () => import('../pages/GaokaoReviewPage');

export function preloadRouteForPath(path: string): Promise<unknown> {
  if (path.startsWith('/gaokao')) return settlePreload(loadGaokaoReviewPage);
  if (path.startsWith('/review')) return settlePreload(loadReviewPage);
  if (path.startsWith('/train')) return settlePreload(loadTrainPage);
  if (path.startsWith('/sync')) return settlePreload(loadSyncPage);
  return Promise.resolve(null);
}

function settlePreload(loader: () => Promise<unknown>): Promise<unknown> {
  return loader().catch(() => null);
}

export function preloadSyncPage() {
  void preloadRouteForPath('/sync');
}

export function preloadTrainPage() {
  void preloadRouteForPath('/train');
}

export function preloadReviewPage() {
  void preloadRouteForPath('/review');
}

export function preloadGaokaoReviewPage() {
  void preloadRouteForPath('/gaokao');
}

export function preloadPrimaryStudentRoutes() {
  if (import.meta.env.MODE === 'test') return;
  scheduleIdlePreload(() => {
    preloadTrainPage();
    preloadReviewPage();
  });
}

function scheduleIdlePreload(task: () => void): void {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(task, { timeout: 2000 });
    return;
  }
  globalThis.setTimeout(task, 800);
}
