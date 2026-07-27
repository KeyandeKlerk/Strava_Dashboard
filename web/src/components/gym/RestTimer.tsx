"use client";
import { useEffect, useState } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { computeRemainingSeconds } from "@/lib/gymOffline/liveSession";

// Countdown display only — the actual timer state (restEndsAt) lives in
// GymOfflineContext so CompactSessionBar can show the same countdown outside
// this component's tree (see gym/layout.tsx). This component just ticks its
// own 1s re-render and renders whatever the context says. The completion
// beep fires once from the provider itself, not from here — see
// context.tsx's restEndsAt effect.
export function RestTimer() {
  const { restEndsAt, restPresetSeconds, stopRestTimer, cycleRestPreset } = useGymOffline();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (restEndsAt == null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [restEndsAt]);

  const remaining = computeRemainingSeconds(restEndsAt, now);
  const isRunning = remaining != null;

  return (
    <div className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
      <span className="text-neutral-500">Rest timer</span>
      {isRunning ? (
        <div className="flex items-center gap-3">
          <span className="font-mono text-base tabular-nums" aria-live="polite">
            {remaining}s
          </span>
          <button type="button" onClick={stopRestTimer} className="text-xs text-neutral-500 underline">
            Skip
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={cycleRestPreset}
          className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
        >
          {restPresetSeconds}s
        </button>
      )}
    </div>
  );
}
