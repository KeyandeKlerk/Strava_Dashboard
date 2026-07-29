import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serialQueue";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createSerialQueue", () => {
  it("does not start the next task until the previous one settles", async () => {
    const queue = createSerialQueue();
    const started: number[] = [];
    const gate1 = deferred<void>();

    const p1 = queue.enqueue(async () => {
      started.push(1);
      await gate1.promise;
      return "one";
    });
    const p2 = queue.enqueue(async () => {
      started.push(2);
      return "two";
    });

    // Let pending microtasks flush — task 2 must not have started yet,
    // since task 1 is still awaiting its gate.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([1]);

    gate1.resolve();
    expect(await p1).toBe("one");
    expect(await p2).toBe("two");
    expect(started).toEqual([1, 2]);
  });

  it("continues the queue after a task rejects, rather than jamming subsequent tasks", async () => {
    const queue = createSerialQueue();
    const p1 = queue.enqueue(async () => {
      throw new Error("boom");
    });
    const p2 = queue.enqueue(async () => "two");

    await expect(p1).rejects.toThrow("boom");
    expect(await p2).toBe("two");
  });

  it("resolves each caller's promise with that task's own result", async () => {
    const queue = createSerialQueue();
    const p1 = queue.enqueue(async () => 1);
    const p2 = queue.enqueue(async () => 2);
    const p3 = queue.enqueue(async () => 3);

    expect(await Promise.all([p1, p2, p3])).toEqual([1, 2, 3]);
  });
});
