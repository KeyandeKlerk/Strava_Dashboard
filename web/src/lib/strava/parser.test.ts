import { describe, expect, it } from "vitest";
import { parseActivity, type RawStravaActivity } from "./parser";

function baseRaw(overrides: Partial<RawStravaActivity> = {}): RawStravaActivity {
  return {
    id: 1,
    name: "Morning Run",
    sport_type: "Run",
    start_date_local: "2026-07-20T06:00:00Z",
    distance: 10000,
    moving_time: 3000,
    elapsed_time: 3100,
    ...overrides,
  };
}

describe("parseActivity", () => {
  it("maps description when present", () => {
    const result = parseActivity(baseRaw({ description: "Felt great, new shoes" }));
    expect(result.description).toBe("Felt great, new shoes");
  });

  it("maps description to null when absent", () => {
    const result = parseActivity(baseRaw());
    expect(result.description).toBeNull();
  });
});
