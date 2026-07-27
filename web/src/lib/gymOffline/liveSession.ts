// Pure helpers for deriving "what's happening in the live session right now"
// from raw cached data, extracted so they're unit-testable without React or
// a DOM (this repo has no jsdom/testing-library — see liveSession.test.ts).
// Shared by LiveSessionPanel (the full in-session view) and CompactSessionBar
// (the persistent strip shown on every /gym/* tab).
import type { CachedSession } from "./db";

// The most recently started session that hasn't been ended yet — durable
// across reloads/app kills since `sessions` is populated from IndexedDB, not
// transient React state.
export function getActiveSession(sessions: CachedSession[]): CachedSession | undefined {
  return [...sessions]
    .filter((s) => !s.endedAt)
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
}

export function formatMmSs(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Gym sessions routinely run past an hour, unlike a rest countdown — this
// wraps formatMmSs with hour handling (h:mm:ss, hours unpadded) so elapsed
// session time never overflows into e.g. "75:14".
export function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  if (clamped < 3600) return formatMmSs(clamped);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Shared by CompactSessionBar and LiveSessionPanel — both derive a
// human-readable weekday label from a session's plain sessionDate string.
export function weekdayNameFor(sessionDate: string): string {
  return new Date(`${sessionDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
}

// `endsAt`/`now` are both epoch-ms timestamps. Rounds up so a display tied to
// a 1s tick never flashes "0" a beat before the timer's own completion effect
// actually fires.
export function computeRemainingSeconds(endsAt: number | null, now: number): number | null {
  if (endsAt == null) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}
