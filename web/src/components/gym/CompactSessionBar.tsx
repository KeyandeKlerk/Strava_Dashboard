"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useGymOffline } from "@/lib/gymOffline/context";
import { computeRemainingSeconds, formatMmSs, getActiveSession } from "@/lib/gymOffline/liveSession";

function weekdayNameFor(sessionDate: string): string {
  return new Date(`${sessionDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
}

// Always-visible summary of the in-progress session, shown on every /gym/*
// tab (rendered once in gym/layout.tsx) so stepping onto Plan/Insights/Weight
// mid-workout doesn't lose sight of it. Tapping it navigates to the Sessions
// tab, where the full LiveSessionPanel (timer, queue, set-logging) lives —
// there's no separate expand/collapse state, "expanding" just means
// navigating there.
export function CompactSessionBar() {
  const { sessions, sets, restEndsAt } = useGymOffline();
  const [now, setNow] = useState(() => Date.now());

  const activeSession = useMemo(() => getActiveSession(sessions), [sessions]);
  const activeSetCount = useMemo(() => {
    if (!activeSession) return 0;
    return sets.filter((s) => s.sessionClientUuid === activeSession.clientUuid).length;
  }, [sets, activeSession]);

  useEffect(() => {
    if (!activeSession) return;
    // Seed `now` immediately when a session becomes active (this component
    // is mounted from page load, long before any session starts, so the
    // `useState` initializer above can be arbitrarily stale by then) rather
    // than waiting for the first setInterval tick a second later — see
    // RestTimer.tsx's identical fix for the same underlying bug shape.
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeSession]);

  if (!activeSession) return null;

  const restRemaining = computeRemainingSeconds(restEndsAt, now);
  const startedAtMs = activeSession.startedAt ? new Date(activeSession.startedAt).getTime() : now;
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAtMs) / 1000));

  const timeLabel = restRemaining != null ? `${formatMmSs(restRemaining)} rest` : formatMmSs(elapsedSeconds);

  return (
    <Link
      href="/gym"
      className="mb-3 flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs
                 dark:border-violet-900 dark:bg-violet-950/30"
    >
      <span className="flex items-center gap-2 font-medium text-violet-700 dark:text-violet-300">
        <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
        {weekdayNameFor(activeSession.sessionDate)} session
      </span>
      <span className="flex items-center gap-3 text-violet-700 dark:text-violet-300">
        <span className="font-mono tabular-nums">{timeLabel}</span>
        <span>{activeSetCount} sets</span>
        <span aria-hidden="true">&rsaquo;</span>
      </span>
    </Link>
  );
}
