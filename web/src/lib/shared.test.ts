import { describe, expect, it } from "vitest";
import {
  SESSION_ICON,
  computeReadiness,
  computeTrainingStatus,
  danielsVo2max,
  firstNonNull,
  latestCompleteDay,
  riegelPredict,
  weekDates,
} from "./shared";

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

describe("latestCompleteDay", () => {
  it("skips today's row even when it's the first (most-recent-first) row", () => {
    const rows = [
      { day: "2026-07-20", v: 0 }, // today — incomplete, should be skipped
      { day: "2026-07-19", v: 5 },
      { day: "2026-07-18", v: 3 },
    ];
    expect(latestCompleteDay(rows, "v", "2026-07-20")).toBe(5);
  });

  it("falls back through null rows before today", () => {
    const rows = [
      { day: "2026-07-20", v: 9 },
      { day: "2026-07-19", v: null },
      { day: "2026-07-18", v: 7 },
    ];
    expect(latestCompleteDay(rows, "v", "2026-07-20")).toBe(7);
  });

  it("returns null when only today has data", () => {
    const rows = [{ day: "2026-07-20", v: 9 }];
    expect(latestCompleteDay(rows, "v", "2026-07-20")).toBeNull();
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

describe("danielsVo2max", () => {
  it("matches the Daniels-Gilbert formula for a 5K in 20:00", () => {
    expect(danielsVo2max(5, 20)).toBeCloseTo(49.81, 1);
  });

  it("matches the Daniels-Gilbert formula for a 10K in 45:00", () => {
    expect(danielsVo2max(10, 45)).toBeCloseTo(45.26, 1);
  });

  it("gives a higher VO2max for a faster time over the same distance", () => {
    expect(danielsVo2max(5, 18)).toBeGreaterThan(danielsVo2max(5, 20));
  });
});

describe("riegelPredict", () => {
  it("predicts a half marathon time from a 10K performance", () => {
    expect(riegelPredict(10, 40, 21.0975)).toBeCloseTo(88.26, 1);
  });

  it("predicts a 10K time from a 5K performance", () => {
    expect(riegelPredict(5, 20, 10)).toBeCloseTo(41.7, 1);
  });

  it("returns the base time unchanged when target distance equals base distance", () => {
    expect(riegelPredict(10, 40, 10)).toBeCloseTo(40, 5);
  });
});

describe("computeTrainingStatus", () => {
  const base = { ctlNow: 50, ctlPast: 50, tsb: 0, acwr: 1.0, rampPct: 0 };

  it("is Insufficient Data when CTL/TSB history is missing", () => {
    expect(computeTrainingStatus({ ctlNow: null, ctlPast: null, tsb: null, acwr: null, rampPct: null }).status).toBe(
      "Insufficient Data",
    );
  });

  it("is Overreaching when ACWR is too high, even if CTL/TSB look fine", () => {
    expect(computeTrainingStatus({ ...base, acwr: 1.5 }).status).toBe("Overreaching");
  });

  it("is Overreaching when ramp % is too high", () => {
    expect(computeTrainingStatus({ ...base, rampPct: 20 }).status).toBe("Overreaching");
  });

  it("is Overreaching when TSB is deeply negative", () => {
    expect(computeTrainingStatus({ ...base, tsb: -35 }).status).toBe("Overreaching");
  });

  it("is Recovery when TSB is high and CTL isn't rising", () => {
    expect(computeTrainingStatus({ ...base, tsb: 20, ctlNow: 48, ctlPast: 50 }).status).toBe("Recovery");
  });

  it("is Peaking when TSB is elevated and CTL is roughly flat-to-rising", () => {
    expect(computeTrainingStatus({ ...base, tsb: 8, ctlNow: 51, ctlPast: 50 }).status).toBe("Peaking");
  });

  it("is Productive when CTL is climbing and ACWR is in the safe band", () => {
    expect(computeTrainingStatus({ ...base, tsb: -5, ctlNow: 55, ctlPast: 50, acwr: 1.1 }).status).toBe("Productive");
  });

  it("is Detraining when CTL has been falling", () => {
    expect(computeTrainingStatus({ ...base, tsb: 2, ctlNow: 45, ctlPast: 50 }).status).toBe("Detraining");
  });

  it("is Maintaining in a steady state that matches no other rule", () => {
    expect(computeTrainingStatus({ ...base, tsb: 0, ctlNow: 50, ctlPast: 50, acwr: 1.0 }).status).toBe("Maintaining");
  });
});
