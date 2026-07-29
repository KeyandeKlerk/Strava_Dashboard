// Runs enqueued async tasks strictly one after another, regardless of how
// long each takes. Use when callers can fire a mutation again before the
// previous one's round-trip finishes, and the server applies a whole-state
// overwrite (not a diff) — without this, a slower earlier call resolving
// after a faster later one silently reverts the later call's result.
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.catch(() => {}).then(task);
      tail = result.catch(() => {});
      return result;
    },
  };
}
