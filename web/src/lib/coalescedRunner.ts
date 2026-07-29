// Wraps a task so a call that arrives while the task is already running
// isn't silently dropped: it's coalesced into one guaranteed rerun once the
// in-flight run finishes, rather than requiring some other external trigger
// (a reconnect, a tab-visibility change) to pick up whatever caused that call.
export function createCoalescedRunner(task: () => Promise<void>): () => Promise<void> {
  let running = false;
  let rerunRequested = false;

  return async function run(): Promise<void> {
    if (running) {
      rerunRequested = true;
      return;
    }
    running = true;
    try {
      do {
        rerunRequested = false;
        await task();
      } while (rerunRequested);
    } finally {
      running = false;
    }
  };
}
