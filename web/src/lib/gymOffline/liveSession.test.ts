import { describe, expect, it } from "vitest";
import type { CachedSession } from "./db";
import { computeRemainingSeconds, formatMmSs, getActiveSession } from "./liveSession";

function makeSession(overrides: Partial<CachedSession> = {}): CachedSession {
  return {
    clientUuid: "s1",
    id: null,
    sessionDate: "2026-07-27",
    startedAt: "2026-07-27T10:00:00.000Z",
    endedAt: null,
    activityId: null,
    notes: null,
    ...overrides,
  };
}

describe("getActiveSession", () => {
  it("returns undefined when there are no sessions", () => {
    expect(getActiveSession([])).toBeUndefined();
  });

  it("ignores sessions that have ended", () => {
    const ended = makeSession({ clientUuid: "ended", endedAt: "2026-07-27T11:00:00.000Z" });
    expect(getActiveSession([ended])).toBeUndefined();
  });

  it("returns the most recently started session with no endedAt", () => {
    const older = makeSession({ clientUuid: "older", startedAt: "2026-07-27T09:00:00.000Z" });
    const newer = makeSession({ clientUuid: "newer", startedAt: "2026-07-27T10:00:00.000Z" });
    expect(getActiveSession([older, newer])).toEqual(newer);
  });

  it("skips ended sessions even if started more recently than an active one", () => {
    const active = makeSession({ clientUuid: "active", startedAt: "2026-07-27T09:00:00.000Z" });
    const endedLater = makeSession({
      clientUuid: "ended-later",
      startedAt: "2026-07-27T10:00:00.000Z",
      endedAt: "2026-07-27T10:30:00.000Z",
    });
    expect(getActiveSession([active, endedLater])).toEqual(active);
  });
});

describe("formatMmSs", () => {
  it("formats sub-minute durations with a leading zero on seconds", () => {
    expect(formatMmSs(45)).toBe("0:45");
    expect(formatMmSs(5)).toBe("0:05");
  });

  it("formats multi-minute durations", () => {
    expect(formatMmSs(125)).toBe("2:05");
    expect(formatMmSs(600)).toBe("10:00");
  });

  it("clamps negative input to 0:00", () => {
    expect(formatMmSs(-5)).toBe("0:00");
  });
});

describe("computeRemainingSeconds", () => {
  it("returns null when endsAt is null", () => {
    expect(computeRemainingSeconds(null, 1_000)).toBeNull();
  });

  it("rounds up the remaining time to the nearest second", () => {
    expect(computeRemainingSeconds(10_000, 8_500)).toBe(2);
  });

  it("floors at 0 once endsAt has passed", () => {
    expect(computeRemainingSeconds(10_000, 12_000)).toBe(0);
  });
});
