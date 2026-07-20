import { describe, expect, it } from "vitest";
import { SESSION_ICON, computeReadiness, firstNonNull, weekDates } from "./shared";

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

describe("firstNonNull", () => {
  it("returns the first non-null value for the given key", () => {
    const rows = [{ v: null }, { v: null }, { v: 5 }, { v: 3 }];
    expect(firstNonNull(rows, "v")).toBe(5);
  });

  it("returns null when every row is null", () => {
    expect(firstNonNull([{ v: null }, { v: null }], "v")).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(firstNonNull([] as Array<{ v: number | null }>, "v")).toBeNull();
  });
});

describe("computeReadiness", () => {
  it("is red if any signal is red, regardless of the others", () => {
    const result = computeReadiness([
      { label: "ACWR", flag: "green" },
      { label: "Ramp rate", flag: "red", detail: "+40%" },
      { label: "Monotony", flag: "green" },
    ]);
    expect(result.verdict).toBe("red");
    expect(result.reasons).toEqual(["Ramp rate (+40%)"]);
  });

  it("is yellow if the worst signal is yellow", () => {
    const result = computeReadiness([
      { label: "ACWR", flag: "green" },
      { label: "Monotony", flag: "yellow" },
    ]);
    expect(result.verdict).toBe("yellow");
    expect(result.reasons).toEqual(["Monotony"]);
  });

  it("is green when at least one signal is green and none are worse", () => {
    const result = computeReadiness([
      { label: "ACWR", flag: "green" },
      { label: "Monotony", flag: "gray" },
    ]);
    expect(result.verdict).toBe("green");
    expect(result.reasons).toEqual([]);
  });

  it("is gray when every signal is gray (no data yet)", () => {
    const result = computeReadiness([
      { label: "ACWR", flag: "gray" },
      { label: "Monotony", flag: "gray" },
    ]);
    expect(result.verdict).toBe("gray");
    expect(result.reasons).toEqual([]);
  });

  it("lists every red reason, not just the first", () => {
    const result = computeReadiness([
      { label: "ACWR", flag: "red", detail: "1.6" },
      { label: "Long run %", flag: "red", detail: "42%" },
      { label: "Monotony", flag: "yellow" },
    ]);
    expect(result.verdict).toBe("red");
    expect(result.reasons).toEqual(["ACWR (1.6)", "Long run % (42%)"]);
  });
});
