"use client";
import { useGymOffline } from "@/lib/gymOffline/context";
import { WeightUnitToggle } from "./WeightUnitToggle";

// Persistent across all /gym/* pages (rendered once in gym/layout.tsx,
// inside GymOfflineProvider) — previously WeightUnitToggle only appeared on
// /gym itself, mid-session, so switching units required navigating back to
// the live session view even though Insights/Body Weight/Plan all display
// weights too. The online/pending indicator is this module's gym-specific
// equivalent of the dashboard layout's "Last synced ..." strip
// (web/src/app/(dashboard)/layout.tsx) — gym data is offline-first via
// IndexedDB rather than server-fetched, so "last synced" doesn't apply the
// same way, but the user still deserves a persistent freshness signal.
export function GymStatusHeader() {
  const { isOnline, pendingCount } = useGymOffline();

  return (
    <div className="mb-3 flex items-center justify-between text-xs text-neutral-400">
      <span>
        {!isOnline ? (
          <span className="text-amber-600">Offline</span>
        ) : pendingCount > 0 ? (
          <span>{pendingCount} pending sync</span>
        ) : (
          <span>Synced</span>
        )}
      </span>
      <WeightUnitToggle />
    </div>
  );
}
