import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const ROUTE_RELOAD_KEY_PREFIX = 'openphysics:route-chunk-reload:';

export type RouteRecoveryEnvironment = {
  pathname: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  reload: () => void;
};

function getBrowserEnvironment(): RouteRecoveryEnvironment | null {
  if (typeof window === 'undefined') return null;

  try {
    return {
      pathname: window.location.pathname,
      storage: window.sessionStorage,
      reload: () => window.location.reload(),
    };
  } catch {
    return null;
  }
}

function reloadKey(pathname: string): string {
  return `${ROUTE_RELOAD_KEY_PREFIX}${pathname}`;
}

export function isRouteChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ChunkLoadError') return true;

  return /(?:failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to load module script|loading chunk .+ failed|unable to preload css|load failed)/i.test(
    error.message,
  );
}

export async function importRouteWithRecovery<T>(
  importer: () => Promise<T>,
  environment: RouteRecoveryEnvironment | null = getBrowserEnvironment(),
): Promise<T> {
  const key = environment ? reloadKey(environment.pathname) : null;

  try {
    const module = await importer();
    if (environment && key) environment.storage.removeItem(key);
    return module;
  } catch (error) {
    if (!environment || !key || !isRouteChunkLoadError(error)) throw error;

    let alreadyReloaded = false;
    try {
      alreadyReloaded = Boolean(environment.storage.getItem(key));
    } catch {
      throw error;
    }
    if (alreadyReloaded) throw error;

    try {
      environment.storage.setItem(key, '1');
      environment.reload();
    } catch {
      try {
        environment.storage.removeItem(key);
      } catch {
        // The original import error remains the useful failure signal.
      }
      throw error;
    }

    // Keep Suspense mounted while the browser replaces the stale application shell.
    return new Promise<T>(() => undefined);
  }
}

export function lazyRoute<T extends ComponentType>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => importRouteWithRecovery(importer));
}
