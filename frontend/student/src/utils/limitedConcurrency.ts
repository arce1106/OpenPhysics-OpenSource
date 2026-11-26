export async function runLimitedConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  if (!tasks.length) return [];
  const concurrency = Math.max(1, Math.min(limit, tasks.length));
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;
  const errors: unknown[] = [];

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = await tasks[currentIndex]();
      } catch (error) {
        errors.push(error);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (errors.length) throw errors[0];
  return results;
}
