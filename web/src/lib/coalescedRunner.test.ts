import { describe, expect, it } from "vitest";
import { createCoalescedRunner } from "./coalescedRunner";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createCoalescedRunner", () => {
  it("runs the task once for a single call", async () => {
    let runs = 0;
    const run = createCoalescedRunner(async () => {
      runs++;
    });

    await run();

    expect(runs).toBe(1);
  });

  it("runs the task again after it finishes if invoked again while already running, instead of silently no-op'ing", async () => {
    let runs = 0;
    const gate1 = deferred<void>();
    const run = createCoalescedRunner(async () => {
      runs++;
      if (runs === 1) await gate1.promise;
    });

    const p1 = run(); // starts running (run 1)
    const p2 = run(); // arrives mid-run-1 — must not be dropped

    gate1.resolve();
    await Promise.all([p1, p2]);

    expect(runs).toBe(2);
  });

  it("coalesces many calls that arrive during one run into a single rerun, not one rerun per call", async () => {
    let runs = 0;
    const gate1 = deferred<void>();
    const run = createCoalescedRunner(async () => {
      runs++;
      if (runs === 1) await gate1.promise;
    });

    const p1 = run();
    const p2 = run();
    const p3 = run();
    const p4 = run();

    gate1.resolve();
    await Promise.all([p1, p2, p3, p4]);

    expect(runs).toBe(2);
  });

  it("does not rerun when no call arrived while the task was running", async () => {
    let runs = 0;
    const run = createCoalescedRunner(async () => {
      runs++;
    });

    await run();
    await run();

    expect(runs).toBe(2);
  });
});
