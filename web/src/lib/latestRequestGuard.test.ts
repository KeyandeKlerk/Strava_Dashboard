import { describe, expect, it } from "vitest";
import { createLatestRequestGuard } from "./latestRequestGuard";

describe("createLatestRequestGuard", () => {
  it("reports the most recently begun id as latest", () => {
    const guard = createLatestRequestGuard<number>();
    guard.begin(1);
    expect(guard.isLatest(1)).toBe(true);
  });

  it("reports an earlier id as no longer latest once a newer one begins", () => {
    const guard = createLatestRequestGuard<number>();
    guard.begin(1);
    guard.begin(2);
    expect(guard.isLatest(1)).toBe(false);
    expect(guard.isLatest(2)).toBe(true);
  });

  it("reports false before anything has begun", () => {
    const guard = createLatestRequestGuard<number>();
    expect(guard.isLatest(1)).toBe(false);
  });
});
