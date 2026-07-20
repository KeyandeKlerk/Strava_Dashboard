"use client";
import { Bar, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NutritionLogRow } from "@/lib/metrics";
import { shortDate } from "@/lib/shared";
import { CHART_HEIGHT, CHART_MARGIN, SERIES, TOOLTIP_STYLE, Y_AXIS_WIDTH, dateTooltipLabel } from "./chartTheme";

// `data` must already be ascending (oldest -> newest) — pageData.ts's
// nutritionLogHistory() already orders it that way. Do not slice/reverse
// here; Recharts renders array order left-to-right (see FatigueCharts.tsx's
// ramp/monotony/strain fix for what happens when that invariant breaks).
export function CarbsPerHourChart({ data, targetGPerHour }: { data: NutritionLogRow[]; targetGPerHour: number | null }) {
  const recent = data.filter((d) => d.carbs_g_per_hour != null);
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={recent} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="activity_date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [`${Number(v).toFixed(0)} g/h`, "Carbs"]} />
        {targetGPerHour != null && <ReferenceLine y={targetGPerHour} stroke={SERIES.orange} strokeDasharray="4 2" />}
        <Bar dataKey="carbs_g_per_hour" fill={SERIES.blue} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function SodiumPerHourChart({ data, targetMgPerHour }: { data: NutritionLogRow[]; targetMgPerHour: number | null }) {
  const recent = data.filter((d) => d.sodium_mg_per_hour != null);
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={recent} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="activity_date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [`${Number(v).toFixed(0)} mg/h`, "Sodium"]} />
        {targetMgPerHour != null && <ReferenceLine y={targetMgPerHour} stroke={SERIES.orange} strokeDasharray="4 2" />}
        {/* aqua fails the light-mode contrast check for a single-series (no
            legend) chart per the dataviz skill's validator — violet passes
            clean and stays distinct from CarbsPerHourChart's blue above. */}
        <Bar dataKey="sodium_mg_per_hour" fill={SERIES.violet} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
