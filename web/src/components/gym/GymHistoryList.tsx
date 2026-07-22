"use client";
import { useState } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { GymSessionDetailSheet } from "./GymSessionDetailSheet";

export function GymHistoryList() {
  const { recentSessions } = useGymOffline();
  const [openSessionId, setOpenSessionId] = useState<number | null>(null);

  if (recentSessions.length === 0) {
    return <p className="mt-2 text-sm text-neutral-500">No gym sessions logged yet.</p>;
  }

  return (
    <>
      <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
        {recentSessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              onClick={() => setOpenSessionId(session.id)}
              className="flex w-full items-center justify-between py-2 text-left text-sm"
            >
              <span>{session.session_date}</span>
              <span className="text-neutral-500">
                {session.set_count} sets · {Math.round(session.total_volume_kg)} kg
              </span>
            </button>
          </li>
        ))}
      </ul>

      {openSessionId != null && (
        <GymSessionDetailSheet sessionId={openSessionId} onClose={() => setOpenSessionId(null)} />
      )}
    </>
  );
}
