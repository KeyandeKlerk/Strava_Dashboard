// Ported from dashboard/shared.py's non-HTML helpers.

// Comrades men's medal bands — (name, display_label, cutoff_hours). Only
// rendered when the primary goal race is actually Comrades (see
// pageData.ts's isComradesRace) — not an ambient constant assumed to always
// apply, since this app now supports any goal race.
// Gold (top 10 finishers) is position-based and omitted from time projections.
export const BANDS: ReadonlyArray<[string, string, number]> = [
  ["Wally Hayward", "Sub 6:00", 6.0],
  ["Silver", "6:00 – 7:29", 7.5],
  ["Bill Rowan", "7:30 – 8:59", 9.0],
  ["Robert Mtshali", "9:00 – 9:59", 10.0],
  ["Bronze", "10:00 – 10:59", 11.0],
  ["Vic Clapham", "11:00 – 11:59", 12.0],
];

export const SESSION_ICON: Record<string, string> = {
  rest: "⬜",
  sc: "\u{1F4AA}",
  easy_run: "\u{1F7E2}",
  quality_run: "\u{1F7E1}",
  long_run: "\u{1F535}",
  hills: "\u{1F7E0}",
  cross_training: "\u{1F6B4}",
  cricket: "\u{1F3CF}",
  race: "\u{1F3C6}",
};

export const INTENSITY_LABEL: Record<string, string> = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  race: "RACE",
  rest: "—",
};

export function fmtPace(minPerKm: number | null | undefined): string {
  if (minPerKm == null || Number.isNaN(minPerKm)) return "—";
  const totalSec = Math.round(minPerKm * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Chart axis tick formatters. Built from the Y/M/D components directly
// (rather than `new Date(iso)`, which parses a bare date as UTC midnight and
// can roll back a day once formatted in a negative-UTC-offset timezone).
export function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function shortMonth(iso: string): string {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export type Flag = "green" | "yellow" | "red" | "gray";

export function flag(value: number | null | undefined, low: number, high: number): Flag {
  if (value == null || Number.isNaN(value)) return "gray";
  if (value >= low && value <= high) return "green";
  if (value < low * 0.9 || value > high * 1.15) return "red";
  return "yellow";
}

export const FLAG_EMOJI: Record<Flag, string> = {
  green: "\u{1F7E2}",
  yellow: "\u{1F7E1}",
  red: "\u{1F534}",
  gray: "⚪",
};

// Rows come back most-recent-first from every acwr/ramp/monotony/longPct
// query in metrics.ts — this finds the latest non-null value in that order.
export function firstNonNull<T, K extends keyof T>(rows: T[], key: K): T[K] | null {
  for (const row of rows) if (row[key] != null) return row[key];
  return null;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// acwrHistory/weeklyRampRate/weeklyMonotony's rolling windows are anchored
// on calendar days including today — today's row only reflects however much
// of today has happened so far (0 until you've logged a run), which reads
// as a false dip rather than a real signal. Anchoring "latest" to the last
// fully-elapsed day avoids that morning-before-your-run artifact.
export function latestCompleteDay<T extends { day: string }, K extends keyof T>(
  rows: T[],
  key: K,
  today: string,
): T[K] | null {
  return firstNonNull(
    rows.filter((r) => r.day < today),
    key,
  );
}

// Week-granularity sibling of latestCompleteDay above — for a metric like
// longRunPct (longest run / total distance that week), the current week's
// ratio isn't a real signal until the week is over: one run logged on
// Monday is trivially "100% of this week's volume so far," not an actual
// long-run-percentage violation. Skips any week that hasn't fully elapsed
// yet (today still within [week_start, week_start+6]), not just "today".
export function latestCompleteWeek<T extends { week_start: string }, K extends keyof T>(
  rows: T[],
  key: K,
  today: string,
): T[K] | null {
  return firstNonNull(
    rows.filter((r) => addDaysToDateString(r.week_start, 7) <= today),
    key,
  );
}

// Same "don't read today's still-accruing row as a real signal" concern as
// latestCompleteDay above, but for ctlAtlTsbHistory's rows specifically:
// they're oldest-first (ascending), and the training-status trend needs the
// whole latest-complete-day row (ctl + tsb together) plus another row a
// fixed number of *complete* days before it — not before the raw array end,
// which would silently fold today's not-yet-happened row into the count.
export function ctlTrendInputs<T extends { day: string; ctl: number; tsb: number }>(
  rows: T[],
  today: string,
  lookbackDays: number,
): { ctlNow: number | null; ctlPast: number | null; tsb: number | null } {
  const complete = rows.filter((r) => r.day < today);
  if (complete.length === 0) return { ctlNow: null, ctlPast: null, tsb: null };
  const latest = complete[complete.length - 1];
  const past = complete[Math.max(0, complete.length - 1 - lookbackDays)];
  return { ctlNow: latest.ctl, ctlPast: past.ctl, tsb: latest.tsb };
}

export interface ReadinessSignal {
  label: string;
  flag: Flag;
  detail?: string;
  range?: string;
}

export interface ReadinessResult {
  verdict: Flag;
  reasons: string[];
  signals: ReadinessSignal[];
}

// Worst-signal-wins: a single red flag (e.g. ACWR spiking) shouldn't be
// averaged away by four green ones — training-load safety signals should
// only ever get more cautious, never less, when combined. `signals` is
// echoed back in full (not just the culprits behind `reasons`) so the UI
// can show why every signal reads the way it does, not just the ones that
// tipped the overall verdict.
export function computeReadiness(signals: ReadinessSignal[]): ReadinessResult {
  const reds = signals.filter((s) => s.flag === "red");
  const yellows = signals.filter((s) => s.flag === "yellow");
  const nonGray = signals.filter((s) => s.flag !== "gray");

  const verdict: Flag = reds.length > 0 ? "red" : yellows.length > 0 ? "yellow" : nonGray.length > 0 ? "green" : "gray";
  const culprits = verdict === "red" ? reds : verdict === "yellow" ? yellows : [];
  const reasons = culprits.map((s) => (s.detail ? `${s.label} (${s.detail})` : s.label));

  return { verdict, reasons, signals };
}

export function weekLabel(row: {
  week_number: number;
  week_start_date: string;
  phase: string;
  is_deload: boolean;
  days_done: number;
  total_days: number;
}): string {
  const start = new Date(`${row.week_start_date}T00:00:00`);
  // Calendar-component arithmetic (via addDaysToDateString), not raw ms —
  // 6 * 86400000ms isn't always exactly 6 calendar days in a DST-observing
  // timezone (a "fall back" transition within the week would land this a
  // day early; see this function's test).
  const endDay = Number(addDaysToDateString(row.week_start_date, 6).slice(8, 10));
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
  const deloadTag = row.is_deload ? " [DELOAD]" : "";
  return `Wk ${String(row.week_number).padStart(2, "0")}  ${fmt(start)}–${endDay}  ·  ${row.phase}${deloadTag}  ·  ${row.days_done}/${row.total_days} done`;
}

export interface WeekDate {
  date: string;
  dayName: string;
}

export function weekDates(weekStartDate: string): WeekDate[] {
  const [y, m, d] = weekStartDate.slice(0, 10).split("-").map(Number);
  const start = new Date(y, m - 1, d);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start.getTime());
    day.setDate(day.getDate() + i);
    const yyyy = day.getFullYear();
    const mm = String(day.getMonth() + 1).padStart(2, "0");
    const dd = String(day.getDate()).padStart(2, "0");
    return {
      date: `${yyyy}-${mm}-${dd}`,
      dayName: day.toLocaleDateString("en-US", { weekday: "long" }),
    };
  });
}

// Adds `days` to a YYYY-MM-DD string via local Y/M/D component arithmetic,
// same approach as weekDates above — never round-trips through
// toISOString(), which converts back to UTC and rolls the result a day off
// on any non-UTC-offset server (see this function's test for the reproduction).
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Daniels-Gilbert VO2max formula (Jack Daniels' Running Formula) — a
// public-domain sports-science model, not Strava/Garmin proprietary. Needs
// only a distance+time performance, which is all this app has (no resting
// HR/HRV in the schema, so an HR-reserve-based model isn't viable here).
export function danielsVo2max(distanceKm: number, durationMin: number): number {
  const velocity = (distanceKm * 1000) / durationMin; // meters/min
  const vo2 = -4.6 + 0.182258 * velocity + 0.000104 * velocity ** 2;
  const pctMax =
    0.8 + 0.1894393 * Math.exp(-0.012778 * durationMin) + 0.2989558 * Math.exp(-0.1932605 * durationMin);
  return vo2 / pctMax;
}

// Riegel's endurance-fatigue formula — the same model/exponent already used
// for the Comrades projection (raceDetection.ts), applied generically to any
// target distance instead of one fixed race.
export function riegelPredict(
  baseDistanceKm: number,
  baseTimeMin: number,
  targetDistanceKm: number,
  exponent = 1.06,
): number {
  return baseTimeMin * (targetDistanceKm / baseDistanceKm) ** exponent;
}

export type TrainingStatus = "Peaking" | "Productive" | "Maintaining" | "Overreaching" | "Detraining" | "Recovery" | "Insufficient Data";

export interface TrainingStatusResult {
  status: TrainingStatus;
  description: string;
}

// No industry-standard formula exists for this (Garmin/Firstbeat's is
// proprietary) — a transparent rule ladder over signals already computed
// elsewhere (CTL trend, TSB, ACWR, ramp %). Checked worst-case-first, same
// philosophy as computeReadiness: a single overreaching signal shouldn't be
// averaged away by an otherwise-healthy trend.
export function computeTrainingStatus({
  ctlNow,
  ctlPast,
  tsb,
  acwr,
  rampPct,
}: {
  ctlNow: number | null;
  ctlPast: number | null;
  tsb: number | null;
  acwr: number | null;
  rampPct: number | null;
}): TrainingStatusResult {
  if (ctlNow == null || ctlPast == null || tsb == null) {
    return { status: "Insufficient Data", description: "Not enough training history yet." };
  }

  const ctlTrendPct = ctlPast > 0 ? ((ctlNow - ctlPast) / ctlPast) * 100 : 0;

  if ((acwr != null && acwr > 1.3) || (rampPct != null && rampPct > 15) || tsb < -30) {
    return {
      status: "Overreaching",
      description: "Load has climbed faster than your body is adapting — high injury/burnout risk. Consider backing off.",
    };
  }
  if (tsb > 15 && ctlTrendPct <= 0) {
    return {
      status: "Recovery",
      description: "Fatigue is low and fitness is holding — you're fresh, good timing for a hard effort or racing.",
    };
  }
  if (tsb >= 5 && ctlTrendPct >= -2) {
    return { status: "Peaking", description: "Fitness is high and fatigue is low — this is race-ready form." };
  }
  if (ctlTrendPct > 3 && (acwr == null || (acwr >= 0.8 && acwr <= 1.3))) {
    return { status: "Productive", description: "Fitness is climbing at a safe, sustainable load." };
  }
  if (ctlTrendPct < -3) {
    return { status: "Detraining", description: "Fitness has been trending down over the last few weeks." };
  }
  return { status: "Maintaining", description: "Fitness is holding steady." };
}
