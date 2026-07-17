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
