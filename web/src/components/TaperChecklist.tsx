"use client";
import { useEffect, useState } from "react";

const ITEMS: Array<{ id: string; label: string }> = [
  { id: "carb-load", label: "Carb-load 24–48h before race day" },
  { id: "race-kit", label: "Lay out and test race-day kit/outfit" },
  { id: "logistics", label: "Confirm race-morning logistics (transport, start time, bag drop)" },
  { id: "gps-watch", label: "Charge GPS watch and test it" },
  { id: "fueling-plan", label: "Review your fueling plan (see Fueling, above)" },
  { id: "splits", label: "Review projected splits (see Race Prep)" },
];

const STORAGE_KEY = "taper-checklist";

// Persisted to localStorage, not the DB — this is short-lived, seasonal,
// single-device content; doesn't warrant new schema/migrations for a
// checklist that's only relevant for a few weeks per race cycle.
export function TaperChecklist() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // localStorage doesn't exist during SSR, so this can't be a lazy
      // useState initializer without mismatching the server-rendered HTML —
      // reading it post-mount and syncing once is the correct hydration-safe
      // pattern, not the derived-state-in-render case this lint rule targets.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setChecked(JSON.parse(raw));
    } catch {
      // malformed or unavailable storage — start unchecked
    }
  }, []);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable — state still updates for this session
      }
      return next;
    });
  }

  return (
    <div>
      <h2 className="text-base font-semibold">Taper Checklist</h2>
      <ul className="mt-2 space-y-2">
        {ITEMS.map((item) => (
          <li
            key={item.id}
            onClick={() => toggle(item.id)}
            className="flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
          >
            <span aria-hidden="true">{checked[item.id] ? "✅" : "⬜"}</span>
            <span className={checked[item.id] ? "text-neutral-400 line-through" : ""}>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
