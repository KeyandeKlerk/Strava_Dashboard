"use client";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { nextRestTimerPreset, readStoredRestSeconds, storeRestSeconds } from "@/lib/gymRestTimer";
import { playRestTimerBeep } from "@/lib/gymRestTimerAudio";

export interface RestTimerHandle {
  // Starts (or restarts) the countdown at the currently selected preset
  // duration. Call this from wherever a set gets logged.
  start: () => void;
}

// One rest countdown, owned by LiveSessionPanel (one per active session).
// Visual countdown is the primary cue and works standalone; the completion
// beep (see gymRestTimerAudio.ts) is a best-effort secondary cue that can
// silently fail without affecting anything here.
export function RestTimer({ ref }: { ref?: Ref<RestTimerHandle> }) {
  const [presetSeconds, setPresetSeconds] = useState(() => readStoredRestSeconds());
  const [remaining, setRemaining] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearTick() {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  // Stop any running interval on unmount (e.g. session ended mid-countdown).
  useEffect(() => clearTick, []);

  useImperativeHandle(
    ref,
    () => ({
      start() {
        clearTick();
        setRemaining(presetSeconds);
        intervalRef.current = setInterval(() => {
          setRemaining((prev) => {
            if (prev == null || prev <= 1) {
              clearTick();
              playRestTimerBeep();
              return null;
            }
            return prev - 1;
          });
        }, 1000);
      },
    }),
    [presetSeconds],
  );

  function handleStop() {
    clearTick();
    setRemaining(null);
  }

  function cyclePreset() {
    const next = nextRestTimerPreset(presetSeconds);
    setPresetSeconds(next);
    storeRestSeconds(next);
  }

  const isRunning = remaining != null;

  return (
    <div className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
      <span className="text-neutral-500">Rest timer</span>
      {isRunning ? (
        <div className="flex items-center gap-3">
          <span className="font-mono text-base tabular-nums" aria-live="polite">
            {remaining}s
          </span>
          <button type="button" onClick={handleStop} className="text-xs text-neutral-500 underline">
            Skip
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={cyclePreset}
          className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
        >
          {presetSeconds}s
        </button>
      )}
    </div>
  );
}
