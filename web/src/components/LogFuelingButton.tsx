"use client";
import { useState } from "react";
import { LogFuelingSheet } from "@/components/LogFuelingSheet";
import type { RunningActivityOption } from "@/lib/metrics";

export function LogFuelingButton({ activities }: { activities: RunningActivityOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700"
      >
        + Log fueling
      </button>
      {open && <LogFuelingSheet activities={activities} onClose={() => setOpen(false)} />}
    </>
  );
}
