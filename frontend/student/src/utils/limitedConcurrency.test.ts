import { describe, expect, it, vi } from 'vitest';
import { runLimitedConcurrency } from './limitedConcurrency';

describe('runLimitedConcurrency', () => {
  it('waits for every started worker and processes remaining tasks before reporting failure', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const finished = vi.fn();
    const settled = vi.fn();
    const run = runLimitedConcurrency([
      async () => { throw new Error('first failed'); },
      async () => pending,
      async () => { finished(); },
    ], 2).catch(error => { settled(); return error; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).not.toHaveBeenCalled();
    release();
    expect((await run).message).toBe('first failed');
    expect(finished).toHaveBeenCalledOnce();
  });
  it('starts only the configured number of tasks at once', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 5 }, (_, index) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return index;
    });

    const results = await runLimitedConcurrency(tasks, 2);

    expect(peak).toBe(2);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });
});
