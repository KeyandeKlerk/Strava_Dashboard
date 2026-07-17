import { shortDate, shortMonth } from "@/lib/shared";

// Shared layout so every chart's plot area sits consistently in its card.
// Previously each chart left YAxis width unset (Recharts auto-sizes it per
// chart, commonly 40-60px) while only the default 5px right margin balanced
// it — so the plotted bars/lines always sat closer to the right edge than
// the left. Pinning the axis width and giving the right margin a comparable
// value keeps the plot area centered instead.
export const CHART_MARGIN = { top: 8, right: 20, left: 0, bottom: 0 };
export const Y_AXIS_WIDTH = 40;

// Recharts' Tooltip `labelFormatter` type doesn't accept a plain
// `(iso: string) => string` (its label param type is a ReactNode/any
// intersection depending on overload), so narrow at the boundary instead.
export function dateTooltipLabel(label: unknown): string {
  return typeof label === "string" ? shortDate(label) : String(label ?? "");
}

export function monthTooltipLabel(label: unknown): string {
  return typeof label === "string" ? shortMonth(label) : String(label ?? "");
}

// Recharts' Tooltip renders with hardcoded inline styles (white background,
// a fixed gray label color) that ignore the app's own theme entirely — in
// dark mode this showed as a bright white box with low-contrast gray date
// text. `var(--background)`/`var(--foreground)` are the same CSS custom
// properties globals.css already flips via `prefers-color-scheme`, so
// referencing them here keeps the tooltip in sync with light/dark mode
// without any JS-side theme detection. Spread onto every <Tooltip>.
export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "var(--background)",
    borderColor: "rgba(128,128,128,0.4)",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: {
    color: "var(--foreground)",
    fontWeight: 600,
  },
};

// A validated 8-hue categorical palette (fixed order, never cycled — see
// dataviz skill references/palette.md) plus a 5-step sequential blue ramp
// and a fixed status scale. Each value is a CSS custom property (defined in
// globals.css with light/dark variants via prefers-color-scheme), passed
// straight through as an SVG fill/stroke string — browsers resolve `var()`
// in presentation attributes the same as in a stylesheet, so these repaint
// automatically on theme change with no JS-side theme detection.
export const SERIES = {
  blue: "var(--chart-blue)",
  green: "var(--chart-green)",
  magenta: "var(--chart-magenta)",
  yellow: "var(--chart-yellow)",
  aqua: "var(--chart-aqua)",
  orange: "var(--chart-orange)",
  violet: "var(--chart-violet)",
  red: "var(--chart-red)",
};

// Sequential blue ramp (light → dark) for ordered/ordinal data — e.g. HR
// zones, where Z1 (easiest) → Z5 (hardest) is a magnitude-like order, not
// arbitrary identity, so it takes one hue with monotone lightness steps
// rather than distinct categorical hues.
export const SEQUENTIAL_BLUE = [
  "var(--chart-blue-100)",
  "var(--chart-blue-250)",
  "var(--chart-blue-400)",
  "var(--chart-blue-550)",
  "var(--chart-blue-700)",
];

// Fixed status scale — reserved meaning, never themed, never reused for
// plain series identity. Mode-invariant (same hex both themes; only the
// contrast against the surface differs).
export const STATUS = {
  good: "var(--chart-status-good)",
  warning: "var(--chart-status-warning)",
  serious: "var(--chart-status-serious)",
  critical: "var(--chart-status-critical)",
};
