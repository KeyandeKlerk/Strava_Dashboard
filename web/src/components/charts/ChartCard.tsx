import type { ReactNode } from "react";

// Every chart gets a title (what it is) and an optional subtitle (units +
// how to read it), so a chart never has to be understood from raw axis
// numbers alone.
//
// `legend` is for charts that color marks by *meaning* (good/borderline/bad)
// rather than by named series — Recharts' own <Legend> only labels dataKeys,
// so a per-point Cell color (e.g. red/orange/green by threshold) would
// otherwise carry meaning through color alone.
export function ChartCard({
  title,
  subtitle,
  legend,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: Array<{ color: string; label: string }>;
  children: ReactNode;
}) {
  return (
    <div className="mt-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {subtitle && <p className="text-xs text-neutral-500">{subtitle}</p>}
      {legend && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {legend.map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1 text-xs text-neutral-500">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1">{children}</div>
    </div>
  );
}
