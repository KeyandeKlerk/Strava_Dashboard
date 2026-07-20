"use client";
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortDate } from "@/lib/shared";
import { CHART_HEIGHT, CHART_MARGIN, SERIES, TOOLTIP_STYLE, Y_AXIS_WIDTH, dateTooltipLabel } from "./chartTheme";

export function WeeklyElevationChart({ data }: { data: Array<{ week_start: string; weekly_gain_m: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.primary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [`${Number(v).toFixed(0)} m`, "Elevation gain"]} />
        <Bar dataKey="weekly_gain_m" fill={SERIES.blue} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ElevationProfileChart({ data }: { data: Array<{ checkpoint: string; km: number; elevation_m: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="km" tick={{ fontSize: 10 }} type="number" domain={[0, "dataMax"]} unit=" km" />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={(v) => `km ${v}`} formatter={(v) => [`${Number(v).toFixed(0)} m`, "Elevation"]} />
        <Area dataKey="elevation_m" fill={SERIES.blue} fillOpacity={0.2} stroke={SERIES.blue} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
