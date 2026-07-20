// Parity port of tests/test_metrics.py — same fixtures, same assertions,
// against the same in-memory-DuckDB approach as conftest.py's mem_conn fixture.
import type { DuckDBConnection } from "@duckdb/node-api";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestConnection } from "./db/testHelper";
import {
  upsertActivity,
  upsertStreamsDerived,
  upsertGear,
  upsertTrainingPlanWeek,
  upsertRaceEvent,
  upsertRaceAnalysis,
  addDailySession,
  upsertNutritionTargets,
  addNutritionLog,
} from "./db/mutations";
import * as metrics from "./metrics";

let conn: DuckDBConnection;

beforeEach(async () => {
  conn = await createTestConnection();
});

function approx(actual: number, expected: number, tol = 1e-6) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

async function insertRun(
  activityId: number,
  dateStr: string,
  distanceKm: number,
  opts: { movingTimeMin?: number; elevation?: number; loadScore?: number } = {},
) {
  const movingTimeMin = opts.movingTimeMin ?? 60.0;
  const elevation = opts.elevation ?? 100.0;
  const loadScore = opts.loadScore ?? 60.0;
  await upsertActivity(conn, {
    id: activityId,
    name: "Run",
    sport_type: "Run",
    category: "running",
    start_date_local: dateStr,
    distance_km: distanceKm,
    moving_time_min: movingTimeMin,
    elapsed_time_min: movingTimeMin + 2,
    elevation_gain_m: elevation,
    average_heartrate: 145.0,
    max_heartrate: 160.0,
    average_cadence: 172.0,
    average_speed_kmh: distanceKm / (movingTimeMin / 60),
    relative_effort: loadScore,
    load_score: loadScore,
  });
}

async function insertGym(activityId: number, dateStr: string, movingTimeMin = 60.0) {
  await upsertActivity(conn, {
    id: activityId,
    name: "Gym",
    sport_type: "WeightTraining",
    category: "gym",
    start_date_local: dateStr,
    distance_km: null,
    moving_time_min: movingTimeMin,
    elapsed_time_min: movingTimeMin + 5,
    elevation_gain_m: 0.0,
    average_heartrate: null,
    max_heartrate: null,
    average_cadence: null,
    average_speed_kmh: null,
    relative_effort: null,
    load_score: movingTimeMin,
  });
}

async function insertRunWithStreams(
  activityId: number,
  dateStr: string,
  distanceKm: number,
  avgHr: number,
  avgSpeedKmh: number,
  opts: { pctZ2?: number; decoupling?: number; lossM?: number; gap?: number } = {},
) {
  const pctZ2 = opts.pctZ2 ?? 55.0;
  const decoupling = opts.decoupling ?? -1.5;
  const lossM = opts.lossM ?? 80.0;
  const gap = opts.gap ?? 5.8;
  const load = avgHr * 0.5;
  const movingTimeMin = (distanceKm / avgSpeedKmh) * 60;
  await insertRun(activityId, dateStr, distanceKm, { movingTimeMin, loadScore: load });
  await conn.run(
    "UPDATE activities SET average_heartrate = $hr, average_speed_kmh = $speed WHERE id = $id",
    { hr: avgHr, speed: avgSpeedKmh, id: activityId },
  );
  await upsertStreamsDerived(conn, {
    activity_id: activityId,
    elevation_loss_m: lossM,
    decoupling_pct: decoupling,
    pct_time_z1: 5.0,
    pct_time_z2: pctZ2,
    pct_time_z3: 30.0,
    pct_time_z4: 8.0,
    pct_time_z5: 2.0,
    grade_adjusted_pace: gap,
    cadence_avg: 172.5,
  });
}

function rowForDay<T extends { day: string }>(rows: T[], dayStr: string): T {
  const matches = rows.filter((r) => r.day === dayStr);
  expect(matches.length, `expected exactly one row for ${dayStr}, found ${matches.length}`).toBe(1);
  return matches[0];
}

describe("weeklyVolume", () => {
  it("returns rows with run_distance_km", async () => {
    await insertRun(1, "2026-03-11T07:00:00", 10.0);
    await insertRun(2, "2026-03-13T07:00:00", 15.0);
    const rows = await metrics.weeklyVolume(conn);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("run_distance_km");
  });

  it("sums by week", async () => {
    await insertRun(1, "2026-03-11T07:00:00", 10.0); // Mon
    await insertRun(2, "2026-03-13T07:00:00", 15.0); // Wed
    await insertRun(3, "2026-03-18T07:00:00", 12.0); // following Mon
    const rows = await metrics.weeklyVolume(conn);
    expect(rows.length).toBe(2);
    const row = rows.filter((r) => Math.abs(r.run_distance_km - 25.0) < 1e-6);
    expect(row.length).toBe(1);
  });

  it("tracks longest run", async () => {
    await insertRun(1, "2026-03-11T07:00:00", 10.0);
    await insertRun(2, "2026-03-13T07:00:00", 22.0);
    const rows = await metrics.weeklyVolume(conn);
    approx(rows[0].longest_run_km, 22.0);
  });

  it("excludes gym from distance", async () => {
    await insertRun(1, "2026-03-11T07:00:00", 10.0);
    await insertGym(2, "2026-03-12T08:00:00", 60.0);
    const rows = await metrics.weeklyVolume(conn);
    approx(rows[0].run_distance_km, 10.0);
  });

  it("total time includes all categories", async () => {
    await insertRun(1, "2026-03-11T07:00:00", 10.0, { movingTimeMin: 60.0 });
    await insertGym(2, "2026-03-12T08:00:00", 60.0);
    const rows = await metrics.weeklyVolume(conn);
    approx(rows[0].total_time_min, 120.0);
  });
});

it("weeklyCategoryLoad splits categories", async () => {
  await insertRun(1, "2026-03-11T07:00:00", 10.0, { loadScore: 80.0 });
  await insertGym(2, "2026-03-12T08:00:00", 60.0);
  const rows = await metrics.weeklyCategoryLoad(conn);
  approx(rows[0].running_load, 80.0);
  approx(rows[0].gym_load, 60.0);
});

it("recentActivities returns n rows", async () => {
  for (let i = 0; i < 15; i++) {
    await insertRun(i, `2026-03-${String(i + 1).padStart(2, "0")}T07:00:00`, i + 5);
  }
  const rows = await metrics.recentActivities(conn, 10);
  expect(rows.length).toBe(10);
});

describe("acwrHistory", () => {
  it("has expected shape", async () => {
    const data: Array<[number, string, number, number]> = [
      [100, "2026-03-04T07:00:00", 10.0, 80.0],
      [101, "2026-03-06T07:00:00", 8.0, 65.0],
      [102, "2026-03-08T07:00:00", 6.0, 50.0],
      [103, "2026-03-11T07:00:00", 12.0, 90.0],
      [104, "2026-03-13T07:00:00", 10.0, 75.0],
    ];
    for (const [id, d, km, load] of data) {
      await insertRun(id, d, km, { loadScore: load });
    }
    const rows = await metrics.acwrHistory(conn);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("acwr");
    expect(rows[0]).toHaveProperty("load_7d");
  });

  it("is computable with minimal data", async () => {
    await insertRun(1, "2026-03-11T07:00:00", 10.0, { loadScore: 80.0 });
    const rows = await metrics.acwrHistory(conn);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("weeklyRampRate", () => {
  it("returns pct", async () => {
    await insertRun(1, "2026-03-01T07:00:00", 40.0, { loadScore: 40.0 });
    await insertRun(2, "2026-03-14T07:00:00", 44.0, { loadScore: 44.0 });
    const rows = await metrics.weeklyRampRate(conn);
    const row = rowForDay(rows, "2026-03-14");
    approx(row.ramp_pct as number, 10.0, 0.1);
  });

  it("is null until two full windows exist", async () => {
    await insertRun(1, "2026-03-01T07:00:00", 40.0, { loadScore: 40.0 });
    const rows = await metrics.weeklyRampRate(conn);
    const beforeFullWindow = rows.filter((r) => r.day < "2026-03-14");
    expect(beforeFullWindow.filter((r) => r.ramp_pct != null).length).toBe(0);
  });
});

describe("weeklyMonotony", () => {
  it("computes without error", async () => {
    const days = ["2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14", "2026-03-15"];
    const loads = [70.0, 40.0, 80.0, 50.0, 60.0];
    for (let i = 0; i < days.length; i++) {
      await insertRun(200 + i, `${days[i]}T07:00:00`, 10.0, { loadScore: loads[i] });
    }
    const rows = await metrics.weeklyMonotony(conn);
    expect(rows.some((r) => r.monotony != null)).toBe(true);
  });

  it("counts rest days as zero load", async () => {
    const days = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-05", "2026-03-06", "2026-03-07"];
    for (const d of days) {
      const id = Number(d.replace(/-/g, "")) % 100000;
      await insertRun(id, `${d}T07:00:00`, 10.0, { loadScore: 50.0 });
    }
    const rows = await metrics.weeklyMonotony(conn);
    const row = rowForDay(rows, "2026-03-07");
    approx(row.monotony as number, 2.268, 0.01);
  });

  it("rolls forward daily, not by calendar week", async () => {
    const days = [
      "2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04",
      "2026-03-05", "2026-03-06", "2026-03-07",
    ];
    const loads = [50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 52.0];
    for (let i = 0; i < days.length; i++) {
      await insertRun(300 + i, `${days[i]}T07:00:00`, 8.0, { loadScore: loads[i] });
    }
    const rows1 = await metrics.weeklyMonotony(conn);
    const day7 = rowForDay(rows1, "2026-03-07");
    expect(day7.monotony).not.toBeNull();

    await insertRun(999, "2026-03-08T07:00:00", 20.0, { loadScore: 150.0 });
    const rows2 = await metrics.weeklyMonotony(conn);
    const day8 = rowForDay(rows2, "2026-03-08");
    expect(day8.monotony as number).toBeLessThan(day7.monotony as number);
  });
});

it("longRunPct of weekly volume", async () => {
  await insertRun(1, "2026-03-11T07:00:00", 10.0);
  await insertRun(2, "2026-03-13T07:00:00", 30.0);
  const rows = await metrics.longRunPct(conn);
  approx(rows[0].long_run_pct as number, 75.0);
});

it("planAdherence returns expected columns", async () => {
  await upsertTrainingPlanWeek(conn, {
    week_number: 1,
    week_start_date: "2026-03-09",
    phase: "base",
    planned_distance_km: 50.0,
    planned_long_run_km: 18.0,
    planned_sessions: 5,
    is_deload: false,
    notes: "",
  });
  await insertRun(999, "2026-03-13T07:00:00", 45.0);
  const rows = await metrics.planAdherence(conn);
  expect(rows.some((r) => "adherence_pct" in r)).toBe(true);
  const row = rows.find((r) => r.week_number === 1)!;
  approx(row.actual_distance_km, 45.0);
  approx(row.adherence_pct as number, 90.0);
});

it("runPaceTrend includes all runs", async () => {
  await insertRunWithStreams(1, "2026-03-11T07:00:00", 15.0, 145.0, 10.5, { pctZ2: 60.0 });
  await insertRunWithStreams(2, "2026-03-18T07:00:00", 16.0, 143.0, 10.8, { pctZ2: 65.0 });
  await insertRun(3, "2026-03-20T07:00:00", 8.0);
  const rows = await metrics.runPaceTrend(conn);
  expect(rows.length).toBe(3);
});

describe("backToBackRuns", () => {
  it("finds consecutive runs", async () => {
    await insertRun(1, "2026-03-16T07:00:00", 20.0); // Saturday
    await insertRun(2, "2026-03-17T07:00:00", 16.0); // Sunday
    const rows = await metrics.backToBackRuns(conn);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    approx(rows[0].combined_km, 36.0);
  });

  it("excludes non-consecutive runs", async () => {
    await insertRun(1, "2026-03-16T07:00:00", 20.0); // Saturday
    await insertRun(2, "2026-03-18T07:00:00", 16.0); // Monday — gap
    const rows = await metrics.backToBackRuns(conn);
    expect(rows.length).toBe(0);
  });
});

describe("comradesMilestones", () => {
  it("returns expected fields", async () => {
    await insertRunWithStreams(1, "2026-03-16T07:00:00", 30.0, 145.0, 10.0, { lossM: 300.0 });
    const result = await metrics.comradesMilestones(conn);
    expect(result).toHaveProperty("longest_run_km");
    expect(result).toHaveProperty("longest_run_pct_race");
    expect(result).toHaveProperty("total_descent_m");
    approx(result.total_descent_m, 300.0);
    approx(result.longest_run_pct_race, (30.0 / 90.0) * 100, 0.3);
  });

  it("includes gain and run counts", async () => {
    await insertRun(1, "2026-03-11T07:00:00", 25.0, { elevation: 200.0 });
    await insertRun(2, "2026-03-18T07:00:00", 22.0, { elevation: 150.0 });
    await insertRun(3, "2026-03-25T07:00:00", 10.0, { elevation: 50.0 });
    const result = await metrics.comradesMilestones(conn);
    expect(result).toHaveProperty("total_gain_m");
    approx(result.total_gain_m, 400.0);
    expect(result.runs_20plus).toBe(2);
    expect(result.runs_30plus).toBe(0);
  });
});

it("weeklyZoneTime aggregates by week", async () => {
  await insertRunWithStreams(1, "2026-03-11T07:00:00", 15.0, 145.0, 10.5, { pctZ2: 60.0 });
  const rows = await metrics.weeklyZoneTime(conn);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]).toHaveProperty("z2_min");
  // moving_time_min = 15km / 10.5 km/h * 60 = 85.7 min → z2 = 85.7 * 60% = 51.4
  approx(rows[0].z2_min, 51.4, 1.0);
});

it("longRunHistory filters by distance", async () => {
  await insertRun(1, "2026-03-11T07:00:00", 25.0);
  await insertRun(2, "2026-03-12T07:00:00", 10.0);
  const rows = await metrics.longRunHistory(conn, 20.0);
  expect(rows.length).toBe(1);
  approx(rows[0].distance_km, 25.0);
});

describe("longRunHistory limit", () => {
  it("is unbounded when omitted", async () => {
    for (let i = 0; i < 5; i++) {
      await insertRun(100 + i, `2026-03-${11 + i}T07:00:00`, 25.0);
    }
    const rows = await metrics.longRunHistory(conn, 20.0);
    expect(rows.length).toBe(5);
  });

  it("caps to the most recent N when provided", async () => {
    for (let i = 0; i < 5; i++) {
      await insertRun(200 + i, `2026-03-${11 + i}T07:00:00`, 25.0);
    }
    const rows = await metrics.longRunHistory(conn, 20.0, 3);
    expect(rows.length).toBe(3);
    // ORDER BY start_date_local DESC, so the 3 kept are the most recent.
    expect(rows[0].activity_date).toBe("2026-03-15");
    expect(rows[2].activity_date).toBe("2026-03-13");
  });
});

it("monthlyVolume groups by month", async () => {
  await insertRun(1, "2026-03-11T07:00:00", 15.0);
  await insertRun(2, "2026-03-18T07:00:00", 20.0);
  await insertRun(3, "2026-04-01T07:00:00", 10.0);
  const rows = await metrics.monthlyVolume(conn);
  expect(rows.length).toBe(2);
  const march = rows.find((r) => r.month_start.startsWith("2026-03"))!;
  approx(march.run_distance_km, 35.0);
});

describe("ctlAtlTsbHistory", () => {
  it("has expected columns", async () => {
    await insertRun(901, "2026-01-05T07:00:00", 10.0, { loadScore: 80.0 });
    const rows = await metrics.ctlAtlTsbHistory(conn);
    expect(rows.length).toBeGreaterThan(0);
    for (const col of ["day", "load", "ctl", "atl", "tsb"] as const) {
      expect(rows[0]).toHaveProperty(col);
    }
  });

  it("ctl increases with consistent load", async () => {
    // The date spine runs through CURRENT_DATE (today's real wall-clock date),
    // so comparing against the spine's tail would measure CTL decay over the
    // months between this fixture and "today" rather than the load's effect.
    // Compare first vs. last *inserted* day instead — that isolates the effect
    // this test actually names.
    const start = new Date("2026-01-01T00:00:00Z");
    const dates: string[] = [];
    for (let i = 0; i < 50; i++) {
      const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      dates.push(d);
      await insertRun(800 + i, `${d}T07:00:00`, 10.0, { loadScore: 100.0 });
    }
    const rows = await metrics.ctlAtlTsbHistory(conn);
    const firstRow = rowForDay(rows, dates[0]);
    const lastRow = rowForDay(rows, dates[dates.length - 1]);
    expect(lastRow.ctl).toBeGreaterThan(firstRow.ctl);
  });

  it("filters output by since/until", async () => {
    await insertRun(1, "2026-01-15T00:00:00", 10.0);
    await insertRun(2, "2026-02-15T00:00:00", 12.0);
    await insertRun(3, "2026-03-15T00:00:00", 14.0);

    const full = await metrics.ctlAtlTsbHistory(conn);
    expect(full.length).toBeGreaterThan(0);

    const filtered = await metrics.ctlAtlTsbHistory(conn, "2026-02-01", "2026-02-28");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((r) => r.day >= "2026-02-01")).toBe(true);
    expect(filtered.every((r) => r.day <= "2026-02-28")).toBe(true);
    expect(filtered.length).toBeLessThan(full.length);
  });
});

describe("longRunQualityScores", () => {
  it("only includes runs over 20km", async () => {
    await insertRun(701, "2026-02-01T07:00:00", 25.0, { loadScore: 150.0 });
    await insertRun(702, "2026-02-08T07:00:00", 10.0, { loadScore: 60.0 });
    for (const aid of [701, 702]) {
      await upsertStreamsDerived(conn, {
        activity_id: aid,
        elevation_loss_m: 50.0,
        decoupling_pct: 2.0,
        pct_time_z1: 20.0,
        pct_time_z2: 55.0,
        pct_time_z3: 20.0,
        pct_time_z4: 4.0,
        pct_time_z5: 1.0,
        grade_adjusted_pace: 6.0,
        cadence_avg: 172.0,
      });
    }
    const rows = await metrics.longRunQualityScores(conn);
    expect(rows.length).toBe(1);
    approx(rows[0].distance_km, 25.0);
  });

  it("keeps quality score within 0-100", async () => {
    await insertRun(703, "2026-02-15T07:00:00", 30.0, { loadScore: 200.0 });
    await upsertStreamsDerived(conn, {
      activity_id: 703,
      elevation_loss_m: 100.0,
      decoupling_pct: 1.5,
      pct_time_z1: 25.0,
      pct_time_z2: 60.0,
      pct_time_z3: 12.0,
      pct_time_z4: 2.0,
      pct_time_z5: 1.0,
      grade_adjusted_pace: 5.8,
      cadence_avg: 174.0,
    });
    const rows = await metrics.longRunQualityScores(conn);
    const score = rows[0].quality_score;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

it("shoeMileage sums running km", async () => {
  await upsertGear(conn, "gABC", "Test Shoe");
  await insertRun(601, "2026-03-01T07:00:00", 15.0, { loadScore: 90.0 });
  await insertRun(602, "2026-03-08T07:00:00", 20.0, { loadScore: 120.0 });
  await conn.run("UPDATE activities SET gear_id = 'gABC' WHERE id IN (601, 602)");
  const rows = await metrics.shoeMileage(conn);
  const row = rows.find((r) => r.id === "gABC")!;
  approx(row.total_km, 35.0);
  approx(row.km_remaining, 765.0);
});

it("comradesProjectedSplits returns checkpoints ending at Durban", async () => {
  await upsertActivity(conn, {
    id: 88888,
    name: "Race",
    sport_type: "Run",
    category: "running",
    start_date_local: "2026-04-19T06:00:00",
    distance_km: 56.0,
    moving_time_min: 330.0,
    elapsed_time_min: 335.0,
    elevation_gain_m: 800.0,
    average_heartrate: 150.0,
    max_heartrate: 170.0,
    average_cadence: 168.0,
    average_speed_kmh: 10.2,
    relative_effort: 250.0,
    load_score: 250.0,
    gear_id: null,
    gear_name: null,
  });
  const rid = await upsertRaceEvent(conn, {
    name: "Two Oceans",
    race_date: "2026-04-19",
    distance_km: 56.0,
    priority: "A",
  });
  await upsertRaceAnalysis(conn, {
    race_event_id: rid,
    activity_id: 88888,
    comrades_projection_h: 9.5,
    riegel_factor: 1.06,
  });
  const rows = await metrics.comradesProjectedSplits(conn);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]).toHaveProperty("checkpoint");
  expect(rows[0]).toHaveProperty("cumulative_time");
  expect(rows[rows.length - 1].checkpoint).toBe("Durban");
});

describe("weeklyEfficiencyFactor", () => {
  it("returns empty when no data", async () => {
    const rows = await metrics.weeklyEfficiencyFactor(conn);
    expect(rows.length).toBe(0);
  });

  it("excludes single-run weeks", async () => {
    await insertRunWithStreams(1, "2026-03-11T07:00:00", 15.0, 140.0, 10.0);
    const rows = await metrics.weeklyEfficiencyFactor(conn);
    expect(rows.length).toBe(0);
  });

  it("computes weekly mean", async () => {
    await insertRunWithStreams(1, "2026-03-11T07:00:00", 15.0, 140.0, 10.0); // ef = 10/140
    await insertRunWithStreams(2, "2026-03-13T07:00:00", 18.0, 150.0, 12.0); // ef = 12/150
    const rows = await metrics.weeklyEfficiencyFactor(conn);
    expect(rows.length).toBe(1);
    expect(rows[0].run_count).toBe(2);
    const expectedMean = (10.0 / 140.0 + 12.0 / 150.0) / 2;
    approx(rows[0].mean_ef, expectedMean, expectedMean * 0.01);
  });
});

describe("dailyPlanForWeek", () => {
  it("includes each session's id", async () => {
    await upsertTrainingPlanWeek(conn, {
      week_number: 1,
      week_start_date: "2026-07-20",
      phase: "Base",
      planned_distance_km: 10,
      planned_long_run_km: 10,
      planned_sessions: 1,
      is_deload: false,
    });
    const id = await addDailySession(conn, {
      planned_date: "2026-07-20",
      week_number: 1,
      day_of_week: "Monday",
      session_type: "easy_run",
      planned_distance_km: 8,
      intensity: "easy",
      description: "Easy run",
    });

    const rows = await metrics.dailyPlanForWeek(conn, 1);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
  });
});

describe("nutritionLogHistory", () => {
  it("returns empty when no logs", async () => {
    const rows = await metrics.nutritionLogHistory(conn);
    expect(rows.length).toBe(0);
  });

  it("computes g/hr and mg/hr rates from moving time, ascending by activity date", async () => {
    await insertRun(701, "2026-03-01T07:00:00", 25.0, { movingTimeMin: 120.0 }); // 2h run
    await insertRun(702, "2026-03-05T07:00:00", 30.0, { movingTimeMin: 180.0 }); // 3h run
    await addNutritionLog(conn, { activity_id: 701, logged_date: "2026-03-01", carbs_g: 120, sodium_mg: 1000 });
    await addNutritionLog(conn, { activity_id: 702, logged_date: "2026-03-05", carbs_g: 210, sodium_mg: 1800 });

    const rows = await metrics.nutritionLogHistory(conn);
    expect(rows).toHaveLength(2);
    expect(rows[0].activity_date).toBe("2026-03-01");
    approx(rows[0].carbs_g_per_hour!, 60.0);
    approx(rows[0].sodium_mg_per_hour!, 500.0);
    expect(rows[1].activity_date).toBe("2026-03-05");
    approx(rows[1].carbs_g_per_hour!, 70.0);
    approx(rows[1].sodium_mg_per_hour!, 600.0);
  });

  it("guards against zero moving time", async () => {
    await insertRun(703, "2026-03-01T07:00:00", 25.0, { movingTimeMin: 0 });
    await addNutritionLog(conn, { activity_id: 703, logged_date: "2026-03-01", carbs_g: 60, sodium_mg: 500 });
    const rows = await metrics.nutritionLogHistory(conn);
    expect(rows[0].carbs_g_per_hour).toBeNull();
    expect(rows[0].sodium_mg_per_hour).toBeNull();
  });
});

describe("getNutritionTargets", () => {
  it("returns null when unset", async () => {
    expect(await metrics.getNutritionTargets(conn)).toBeNull();
  });

  it("returns the upserted targets", async () => {
    await upsertNutritionTargets(conn, {
      target_carbs_g_per_hour: 90,
      target_sodium_mg_per_hour: 700,
      target_fluid_ml_per_hour: 500,
    });
    const targets = await metrics.getNutritionTargets(conn);
    expect(targets).not.toBeNull();
    approx(targets!.target_carbs_g_per_hour, 90);
    approx(targets!.target_sodium_mg_per_hour, 700);
  });
});

describe("projectedRaceFueling", () => {
  it("returns null without a finish projection or targets", () => {
    expect(metrics.projectedRaceFueling(null, { target_carbs_g_per_hour: 90, target_sodium_mg_per_hour: 700, target_fluid_ml_per_hour: null })).toBeNull();
    expect(metrics.projectedRaceFueling(10, null)).toBeNull();
  });

  it("scales target rates by projected finish hours", () => {
    const result = metrics.projectedRaceFueling(10, {
      target_carbs_g_per_hour: 90,
      target_sodium_mg_per_hour: 700,
      target_fluid_ml_per_hour: 500,
    });
    expect(result).not.toBeNull();
    expect(result!.total_carbs_g).toBe(900);
    expect(result!.total_sodium_mg).toBe(7000);
    expect(result!.total_fluid_ml).toBe(5000);
  });
});

describe("getActivityDetail", () => {
  it("returns null for an unknown id", async () => {
    expect(await metrics.getActivityDetail(conn, 999999)).toBeNull();
  });

  it("returns basic stats with null derived fields when no streams data exists", async () => {
    await insertGym(801, "2026-03-01T07:00:00", 45.0);
    const row = await metrics.getActivityDetail(conn, 801);
    expect(row).not.toBeNull();
    expect(row!.category).toBe("gym");
    expect(row!.moving_time_min).toBe(45.0);
    expect(row!.decoupling_pct).toBeNull();
    expect(row!.z1_min).toBeNull();
  });

  it("returns full stats including pace and zone minutes for a run with streams data", async () => {
    await insertRunWithStreams(802, "2026-03-05T07:00:00", 20.0, 145.0, 10.0, { pctZ2: 60.0, decoupling: 2.0 });
    const row = await metrics.getActivityDetail(conn, 802);
    expect(row).not.toBeNull();
    expect(row!.category).toBe("running");
    approx(row!.pace_min_km!, 6.0);
    approx(row!.decoupling_pct!, 2.0);
    const expectedZ2Min = (20.0 / 10.0) * 60 * 0.6;
    approx(row!.z2_min!, expectedZ2Min, 0.1);
  });
});

describe("nutritionLogsForActivity", () => {
  it("returns empty when no logs exist for the activity", async () => {
    await insertRun(803, "2026-03-01T07:00:00", 25.0, { movingTimeMin: 120.0 });
    expect(await metrics.nutritionLogsForActivity(conn, 803)).toHaveLength(0);
  });

  it("only returns logs for the requested activity", async () => {
    await insertRun(804, "2026-03-01T07:00:00", 25.0, { movingTimeMin: 120.0 });
    await insertRun(805, "2026-03-05T07:00:00", 30.0, { movingTimeMin: 180.0 });
    await addNutritionLog(conn, { activity_id: 804, logged_date: "2026-03-01", carbs_g: 120, sodium_mg: 1000 });
    await addNutritionLog(conn, { activity_id: 805, logged_date: "2026-03-05", carbs_g: 210, sodium_mg: 1800 });

    const rows = await metrics.nutritionLogsForActivity(conn, 804);
    expect(rows).toHaveLength(1);
    expect(rows[0].carbs_g).toBe(120);
    approx(rows[0].carbs_g_per_hour!, 60.0);
  });
});
