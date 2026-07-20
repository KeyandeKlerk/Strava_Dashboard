// Ported from dashboard/shared.py's non-HTML helpers.
export const RACE_DATE = "2027-06-13";
export const RACE_DISTANCE_KM = 90.0;

// Comrades men's medal bands — (name, display_label, cutoff_hours).
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

export interface ReadinessSignal {
  label: string;
  flag: Flag;
  detail?: string;
}

export interface ReadinessResult {
  verdict: Flag;
  reasons: string[];
}

// Worst-signal-wins: a single red flag (e.g. ACWR spiking) shouldn't be
// averaged away by four green ones — training-load safety signals should
// only ever get more cautious, never less, when combined.
export function computeReadiness(signals: ReadinessSignal[]): ReadinessResult {
  const reds = signals.filter((s) => s.flag === "red");
  const yellows = signals.filter((s) => s.flag === "yellow");
  const nonGray = signals.filter((s) => s.flag !== "gray");

  const verdict: Flag = reds.length > 0 ? "red" : yellows.length > 0 ? "yellow" : nonGray.length > 0 ? "green" : "gray";
  const culprits = verdict === "red" ? reds : verdict === "yellow" ? yellows : [];
  const reasons = culprits.map((s) => (s.detail ? `${s.label} (${s.detail})` : s.label));

  return { verdict, reasons };
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
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
  const deloadTag = row.is_deload ? " [DELOAD]" : "";
  return `Wk ${String(row.week_number).padStart(2, "0")}  ${fmt(start)}–${end.getDate()}  ·  ${row.phase}${deloadTag}  ·  ${row.days_done}/${row.total_days} done`;
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
