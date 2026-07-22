import { afterEach, describe, expect, it } from "vitest";
import { getRecentRefreshCount, hasEditableChanges } from "./sync";

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
});
