// Isolated from sync.test.ts because runSync (unlike the pure/DI-friendly
// helpers tested there) reaches straight into the Strava HTTP client and a
// few sibling modules by import rather than by injected parameter — module
// mocking is the only way to control those without real network calls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { createTestConnection } from "../db/testHelper";
import { getLastSynced } from "../db/mutations";
import type { RawStravaActivity } from "./parser";

vi.mock("./client", () => ({
  refreshAccessToken: vi.fn(async () => "test-token"),
  getActivities: vi.fn(async (): Promise<RawStravaActivity[]> => []),
  getActivityById: vi.fn(),
  getGear: vi.fn(async () => null),
}));
vi.mock("./backfill", () => ({ runBackfill: vi.fn(async () => {}) }));
vi.mock("./raceDetection", () => ({ detectAndAnalyseRace: vi.fn(async () => {}) }));

import { getActivities, getGear } from "./client";
import { runSync } from "./sync";

describe("runSync watermark", () => {
  let conn: DuckDBConnection;

  beforeEach(async () => {
    vi.clearAllMocks();
    conn = await createTestConnection();
    // A known gear row so refreshGear's loop actually calls getGear (its
    // gearIds set is otherwise empty when there are no new activities).
    await conn.run("INSERT INTO gear (id, name, is_retired) VALUES ('g1', 'Old Shoe', false)");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("persists a watermark from before the slow post-fetch work, not after it", async () => {
    // Simulate a slow sync: by the time refreshGear's network call resolves,
    // real-world time has moved on (e.g. a new activity could have been
    // created on Strava in that gap).
    vi.mocked(getGear).mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-07-20T12:05:00Z"));
      return null;
    });

    await runSync(conn);

    const lastSynced = await getLastSynced(conn);
    expect(lastSynced).toBe(Math.floor(new Date("2026-07-20T12:00:00Z").getTime() / 1000));
  });

  it("passes the pre-fetch watermark as the after= cursor on the next sync", async () => {
    vi.mocked(getGear).mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-07-20T12:05:00Z"));
      return null;
    });

    await runSync(conn);
    await runSync(conn);

    expect(vi.mocked(getActivities).mock.calls[1][1]).toBe(
      Math.floor(new Date("2026-07-20T12:00:00Z").getTime() / 1000),
    );
  });
});
