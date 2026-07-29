import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_ICON,
  addDaysToDateString,
  computeReadiness,
  computeTrainingStatus,
  ctlTrendInputs,
  danielsVo2max,
  firstNonNull,
  latestCompleteDay,
  latestCompleteWeek,
  riegelPredict,
  weekDates,
  weekLabel,
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

describe("weekLabel", () => {
  const originalTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  function baseRow(overrides: Partial<Parameters<typeof weekLabel>[0]> = {}) {
    return {
      week_number: 1,
      week_start_date: "2026-10-27", // Tue; week runs through Nov 2
      phase: "Base",
      is_deload: false,
      days_done: 0,
      total_days: 7,
      ...overrides,
    };
  }

  it("shows the correct end-of-week date across a DST fall-back transition", () => {
    process.env.TZ = "America/New_York"; // DST ends (fall back) Nov 1, 2026
    const label = weekLabel(baseRow());
    const endDay = label.match(/–(\d+)\s/)?.[1];
    expect(endDay).toBe("2");
  });

  it("shows the correct end-of-week date under UTC (no DST)", () => {
    process.env.TZ = "UTC";
    const label = weekLabel(baseRow());
    const endDay = label.match(/–(\d+)\s/)?.[1];
    expect(endDay).toBe("2");
  });
});

describe("addDaysToDateString", () => {
  const originalTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it("adds days correctly under UTC", () => {
    process.env.TZ = "UTC";
    expect(addDaysToDateString("2026-07-20", 7)).toBe("2026-07-27");
  });

  it("adds days correctly under a positive-UTC-offset timezone, without rolling back a day", () => {
    process.env.TZ = "Africa/Johannesburg"; // UTC+2
    expect(addDaysToDateString("2026-07-20", 7)).toBe("2026-07-27");
  });

  it("adds days correctly under a negative-UTC-offset timezone, without rolling forward a day", () => {
    process.env.TZ = "America/New_York"; // UTC-4/-5
    expect(addDaysToDateString("2026-07-20", 7)).toBe("2026-07-27");
  });

  it("rolls over a month boundary", () => {
    process.env.TZ = "Africa/Johannesburg";
    expect(addDaysToDateString("2026-07-27", 7)).toBe("2026-08-03");
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

describe("latestCompleteWeek", () => {
  it("skips the still-in-progress current week, even mid-week", () => {
    const rows = [
      // 2026-07-20 is a Monday; this week runs through 2026-07-26.
      { week_start: "2026-07-20 00:00:00", v: 100 }, // one run logged so far = 100% "long run" — not a real signal
      { week_start: "2026-07-13 00:00:00", v: 25 },
    ];
    // Wednesday of the current week — week isn't over yet.
    expect(latestCompleteWeek(rows, "v", "2026-07-22")).toBe(25);
  });

  it("skips the current week even on its last calendar day (Sunday)", () => {
    const rows = [
      { week_start: "2026-07-20 00:00:00", v: 100 },
      { week_start: "2026-07-13 00:00:00", v: 25 },
    ];
    expect(latestCompleteWeek(rows, "v", "2026-07-26")).toBe(25);
  });

  it("includes a week once it has fully elapsed", () => {
    const rows = [
      { week_start: "2026-07-20 00:00:00", v: 100 },
      { week_start: "2026-07-13 00:00:00", v: 25 },
    ];
    expect(latestCompleteWeek(rows, "v", "2026-07-27")).toBe(100);
  });

  it("falls back through null rows before the current week", () => {
    const rows = [
      { week_start: "2026-07-20 00:00:00", v: 100 },
      { week_start: "2026-07-13 00:00:00", v: null },
      { week_start: "2026-07-06 00:00:00", v: 30 },
    ];
    expect(latestCompleteWeek(rows, "v", "2026-07-22")).toBe(30);
  });

  it("returns null when only the current (incomplete) week has data", () => {
    const rows = [{ week_start: "2026-07-20 00:00:00", v: 100 }];
    expect(latestCompleteWeek(rows, "v", "2026-07-22")).toBeNull();
  });
});

describe("ctlTrendInputs", () => {
  // ctlAtlTsbHistory's rows are oldest-first (ascending by day), unlike
  // latestCompleteDay's callers (acwr/ramp), which are newest-first.
  function row(day: string, ctl: number, tsb: number) {
    return { day, ctl, tsb };
  }

  it("uses the latest fully-elapsed day, not today's still-accruing (partial) row", () => {
    const rows = [
      row("2026-06-01", 20, 1),
      row("2026-06-02", 21, 1),
      row("2026-07-28", 24.61, 1.9), // yesterday, fully elapsed
      row("2026-07-29", 24.02, 0.12), // today — not done yet (e.g. a night runner who hasn't logged yet)
    ];

    const result = ctlTrendInputs(rows, "2026-07-29", 1);

    expect(result.ctlNow).toBe(24.61);
    expect(result.tsb).toBe(1.9);
  });

  it("counts the lookback from the latest COMPLETE day, not from the raw (today-including) array end", () => {
    // 29 complete days (oldest..newest), then a "today" row that must be
    // excluded from both the "latest" pick and the lookback count.
    const completeDays = Array.from({ length: 29 }, (_, i) => row(`complete-${i}`, i, 0));
    const rows = [...completeDays, row("today", 999, 999)];

    const result = ctlTrendInputs(rows, "today", 28);

    // Latest complete day is index 28 (ctl=28); 28 days before it is index 0 (ctl=0).
    expect(result.ctlNow).toBe(28);
    expect(result.ctlPast).toBe(0);
  });

  it("returns nulls when there is no fully-elapsed day yet", () => {
    const rows = [row("2026-07-29", 24.02, 0.12)];
    const result = ctlTrendInputs(rows, "2026-07-29", 28);
    expect(result).toEqual({ ctlNow: null, ctlPast: null, tsb: null });
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
