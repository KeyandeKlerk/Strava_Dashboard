import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRecentRefreshCount, hasEditableChanges } from "./sync";
import type { DuckDBConnection } from "@duckdb/node-api";
import { createTestConnection } from "../db/testHelper";
import { queryRow } from "../db/client";
import { upsertActivity } from "../db/mutations";
import { refreshRecentActivities } from "./sync";
import type { RawStravaActivity } from "./parser";

describe("hasEditableChanges", () => {
  it("returns false when name, description, and gear_id are all unchanged", () => {
    const stored = { name: "Morning Run", description: "Felt good", gear_id: "g1" };
    const fetched = { name: "Morning Run", description: "Felt good", gear_id: "g1" };
    expect(hasEditableChanges(stored, fetched)).toBe(false);
  });

  it("returns true when gear_id changed (shoe reassigned)", () => {
    const stored = { name: "Morning Run", description: "Felt good", gear_id: "g1" };
    const fetched = { name: "Morning Run", description: "Felt good", gear_id: "g2" };
    expect(hasEditableChanges(stored, fetched)).toBe(true);
  });

  it("returns true when description changed", () => {
    const stored = { name: "Morning Run", description: null, gear_id: "g1" };
    const fetched = { name: "Morning Run", description: "Added notes later", gear_id: "g1" };
    expect(hasEditableChanges(stored, fetched)).toBe(true);
  });

  it("treats null and undefined as equivalent", () => {
    const stored = { name: "Morning Run", description: null, gear_id: "g1" };
    const fetched = { name: "Morning Run", description: undefined, gear_id: "g1" };
    expect(hasEditableChanges(stored, fetched)).toBe(false);
  });
});

describe("getRecentRefreshCount", () => {
  const ORIGINAL = process.env.STRAVA_RECENT_REFRESH_COUNT;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.STRAVA_RECENT_REFRESH_COUNT;
    else process.env.STRAVA_RECENT_REFRESH_COUNT = ORIGINAL;
  });

  it("defaults to 5 when unset", () => {
    delete process.env.STRAVA_RECENT_REFRESH_COUNT;
    expect(getRecentRefreshCount()).toBe(5);
  });

  it("uses the env var when set to a valid positive integer", () => {
    process.env.STRAVA_RECENT_REFRESH_COUNT = "12";
    expect(getRecentRefreshCount()).toBe(12);
  });

  it("falls back to 5 for an invalid value", () => {
    process.env.STRAVA_RECENT_REFRESH_COUNT = "not-a-number";
    expect(getRecentRefreshCount()).toBe(5);
  });

  it('falls back to 5 for a non-integer value like "7.5"', () => {
    process.env.STRAVA_RECENT_REFRESH_COUNT = "7.5";
    expect(getRecentRefreshCount()).toBe(5);
  });

  it('falls back to 5 for a value with trailing non-numeric characters like "10abc"', () => {
    process.env.STRAVA_RECENT_REFRESH_COUNT = "10abc";
    expect(getRecentRefreshCount()).toBe(5);
  });
});

describe("refreshRecentActivities", () => {
  let conn: DuckDBConnection;

  beforeEach(async () => {
    conn = await createTestConnection();
  });

  it("upserts only activities whose editable fields changed, and returns those changes", async () => {
    await upsertActivity(conn, {
      id: 9201,
      name: "Morning Run",
      start_date_local: "2026-07-20T06:00:00",
      gear_id: "g1",
      description: null,
    });
    await upsertActivity(conn, {
      id: 9202,
      name: "Evening Run",
      start_date_local: "2026-07-21T06:00:00",
      gear_id: "g1",
      description: null,
    });

    const rawById: Record<number, RawStravaActivity> = {
      9201: { id: 9201, name: "Morning Run", start_date_local: "2026-07-20T06:00:00Z", gear_id: "g1" },
      9202: {
        id: 9202,
        name: "Evening Run",
        start_date_local: "2026-07-21T06:00:00Z",
        gear_id: "g2",
        description: "Swapped to trail shoes",
      },
    };

    const changed = await refreshRecentActivities(conn, async (id) => rawById[id], 5);

    expect(changed.map((a) => a.id)).toEqual([9202]);

    const row9202 = await queryRow<{ gear_id: string | null; description: string | null }>(
      conn,
      "SELECT gear_id, description FROM activities WHERE id = $id",
      { id: 9202 },
    );
    expect(row9202?.gear_id).toBe("g2");
    expect(row9202?.description).toBe("Swapped to trail shoes");

    const row9201 = await queryRow<{ gear_id: string | null; description: string | null }>(
      conn,
      "SELECT gear_id, description FROM activities WHERE id = $id",
      { id: 9201 },
    );
    expect(row9201?.gear_id).toBe("g1");
    expect(row9201?.description).toBeNull();
  });

  it("respects the count limit, refreshing only the most recent N", async () => {
    await upsertActivity(conn, { id: 9301, name: "Old", start_date_local: "2026-07-01T06:00:00" });
    await upsertActivity(conn, { id: 9302, name: "New", start_date_local: "2026-07-20T06:00:00" });

    const rawById: Record<number, RawStravaActivity> = {
      9301: { id: 9301, name: "Old - edited", start_date_local: "2026-07-01T06:00:00Z" },
      9302: { id: 9302, name: "New - edited", start_date_local: "2026-07-20T06:00:00Z" },
    };

    const changed = await refreshRecentActivities(conn, async (id) => rawById[id], 1);

    expect(changed.map((a) => a.id)).toEqual([9302]);
  });

  it("continues past a fetchDetail failure for one activity", async () => {
    await upsertActivity(conn, { id: 9401, name: "A", start_date_local: "2026-07-19T06:00:00" });
    await upsertActivity(conn, { id: 9402, name: "B", start_date_local: "2026-07-20T06:00:00" });

    const changed = await refreshRecentActivities(
      conn,
      async (id) => {
        if (id === 9402) throw new Error("Strava API 500");
        return { id, name: "A - edited", start_date_local: "2026-07-19T06:00:00Z" };
      },
      5,
    );

    expect(changed.map((a) => a.id)).toEqual([9401]);
  });
});
