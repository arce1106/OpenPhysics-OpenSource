import { describe, expect, it, vi } from 'vitest';
import { importRouteWithRecovery, isRouteChunkLoadError, type RouteRecoveryEnvironment } from './lazyRoute';

function createEnvironment(pathname = '/sync') {
  const values = new Map<string, string>();
  const environment: RouteRecoveryEnvironment = {
    pathname,
    storage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    },
    reload: vi.fn(),
  };

  return { environment, values };
}

describe('route chunk recovery', () => {
  it('recognizes current browser chunk-loading failures without masking module bugs', () => {
    expect(isRouteChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isRouteChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/page-old.js'))).toBe(true);
    expect(isRouteChunkLoadError(new TypeError('Load failed'))).toBe(true);
    expect(isRouteChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false);
  });

  it('returns a loaded route module without reloading', async () => {
    const { environment } = createEnvironment();
    const routeModule = { default: () => null };

    await expect(importRouteWithRecovery(() => Promise.resolve(routeModule), environment)).resolves.toBe(routeModule);
    expect(environment.reload).not.toHaveBeenCalled();
    expect(environment.storage.removeItem).toHaveBeenCalledWith('openphysics:route-chunk-reload:/sync');
  });

  it('reloads once when an obsolete hashed route chunk cannot be imported', async () => {
    const { environment, values } = createEnvironment('/train');
    const load = importRouteWithRecovery(
      () => Promise.reject(new TypeError('Importing a module script failed.')),
      environment,
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(environment.reload).toHaveBeenCalledTimes(1);
    expect(values.get('openphysics:route-chunk-reload:/train')).toBe('1');

    let settled = false;
    void load.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('does not enter a refresh loop when the same route still cannot load', async () => {
    const { environment, values } = createEnvironment('/review');
    values.set('openphysics:route-chunk-reload:/review', '1');
    const error = new TypeError('Failed to fetch dynamically imported module');

    await expect(importRouteWithRecovery(() => Promise.reject(error), environment)).rejects.toBe(error);
    expect(environment.reload).not.toHaveBeenCalled();
  });

  it('surfaces route module execution errors without refreshing', async () => {
    const { environment } = createEnvironment('/sync');
    const error = new TypeError('Cannot read properties of undefined');

    await expect(importRouteWithRecovery(() => Promise.reject(error), environment)).rejects.toBe(error);
    expect(environment.reload).not.toHaveBeenCalled();
  });

  it('clears the retry marker after the refreshed route loads successfully', async () => {
    const { environment, values } = createEnvironment('/review');
    values.set('openphysics:route-chunk-reload:/review', '1');

    await importRouteWithRecovery(() => Promise.resolve({ default: () => null }), environment);

    expect(values.has('openphysics:route-chunk-reload:/review')).toBe(false);
  });
});
