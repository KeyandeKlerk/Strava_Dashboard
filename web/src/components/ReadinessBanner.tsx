import { FLAG_EMOJI, type Flag, type ReadinessSignal } from "@/lib/shared";

const HEADLINE: Record<Flag, string> = {
  green: "Green light — clear to train as planned",
  yellow: "Proceed with caution",
  red: "Back off today — recovery advised",
  gray: "Not enough data yet",
};

// Plain conditional Tailwind classes, matching the existing shoe-mileage
// progress bar's flag-color convention on Race Prep — not the SVG-chart CSS
// var palette, which is for chart marks, not general UI chrome.
const STYLE: Record<Flag, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  yellow: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  red: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  gray: "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400",
};

export function ReadinessBanner({ verdict, signals }: { verdict: Flag; signals: ReadinessSignal[] }) {
  return (
    <div className={`rounded-lg border p-3 ${STYLE[verdict]}`}>
      <p className="text-sm font-semibold">
        {FLAG_EMOJI[verdict]} {HEADLINE[verdict]}
      </p>
      <ul className="mt-2 space-y-0.5 text-xs opacity-90">
        {signals.map((s) => (
          <li key={s.label}>
            {FLAG_EMOJI[s.flag]} {s.label}: {s.detail ?? "—"}
            {s.range ? ` (${s.range})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
