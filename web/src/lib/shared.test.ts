import { describe, expect, it } from "vitest";
import { SESSION_ICON, weekDates } from "./shared";

describe("SESSION_ICON", () => {
  it("has a distinct icon for cross_training (not the rest fallback)", () => {
    expect(SESSION_ICON.cross_training).toBeDefined();
    expect(SESSION_ICON.cross_training).not.toBe(SESSION_ICON.rest);
  });
});

describe("weekDates", () => {
  it("returns the 7 calendar dates and weekday names starting from week_start_date", () => {
    const days = weekDates("2026-07-20");

    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ date: "2026-07-20", dayName: "Monday" });
    expect(days[6]).toEqual({ date: "2026-07-26", dayName: "Sunday" });
  });

  it("rolls over correctly across a month boundary", () => {
    const days = weekDates("2026-07-27");
    expect(days[6]).toEqual({ date: "2026-08-02", dayName: "Sunday" });
  });
});
