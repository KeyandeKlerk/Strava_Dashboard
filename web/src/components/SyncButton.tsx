"use client";
import { useEffect, useState, useTransition } from "react";
import { triggerSyncAction } from "@/lib/syncActions";

// Cooldown after triggering, not a "done" state — triggerSyncAction returns
// as soon as the sync is scheduled via after(), well before it actually
// finishes, so there's no signal to wait for here besides "don't let the
// user re-fire this and burn through Strava's rate limit."
const COOLDOWN_MS = 30_000;

export function SyncButton() {
  const [isPending, startTransition] = useTransition();
  const [cooldown, setCooldown] = useState(false);

  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(false), COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function handleClick() {
    startTransition(async () => {
      await triggerSyncAction();
      setCooldown(true);
    });
  }

  const disabled = isPending || cooldown;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="text-xs text-neutral-400 underline disabled:no-underline disabled:opacity-60"
    >
      {cooldown ? "Sync started — refresh in a bit" : isPending ? "Syncing…" : "Sync now"}
    </button>
  );
}
