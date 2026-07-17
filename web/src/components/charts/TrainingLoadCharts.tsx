"use client";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { shortDate, shortMonth } from "@/lib/shared";
import { CHART_MARGIN, Y_AXIS_WIDTH, dateTooltipLabel, monthTooltipLabel } from "./chartTheme";

const CATEGORY_COLOR: Record<string, string> = {
  running: "#2196F3",
  volleyball: "#FF9800",
  cricket: "#4CAF50",
  gym: "#9C27B0",
};

export function WeeklyDistanceChart({
  data,
}: {
  data: Array<{ week_start: string; planned_km: number; actual_km: number; rolling_4w_avg: number | null }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip labelFormatter={dateTooltipLabel} formatter={(v, name) => [`${Number(v).toFixed(1)} km`, name]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="planned_km" name="Planned" fill="rgba(100,149,237,0.35)" />
        <Bar dataKey="actual_km" name="Actual" fill="rgba(50,168,82,0.85)" />
        <Line dataKey="rolling_4w_avg" name="4-Week Avg" stroke="orange" strokeDasharray="4 2" dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function TimeOnFeetChart({ data }: { data: Array<{ week_start: string; run_time_h: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip labelFormatter={dateTooltipLabel} formatter={(v) => [`${Number(v).toFixed(1)} h`, "Time"]} />
        <ReferenceLine y={8} stroke="orange" strokeDasharray="2 2" />
        <Bar dataKey="run_time_h" fill="rgba(156,39,176,0.7)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MonthlyDistanceChart({ data }: { data: Array<{ month_start: string; run_distance_km: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="month_start" tickFormatter={shortMonth} tick={{ fontSize: 10 }} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip labelFormatter={monthTooltipLabel} formatter={(v) => [`${Number(v).toFixed(1)} km`, "Distance"]} />
        <Bar dataKey="run_distance_km" fill="rgba(50,168,82,0.8)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MonthlyTimeChart({ data }: { data: Array<{ month_start: string; run_time_h: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="month_start" tickFormatter={shortMonth} tick={{ fontSize: 10 }} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip labelFormatter={monthTooltipLabel} formatter={(v) => [`${Number(v).toFixed(1)} h`, "Time"]} />
        <Line dataKey="run_time_h" stroke="purple" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function LongRunProgressionChart({ data, raceDistanceKm }: { data: Array<{ week_start: string; longest_run_km: number }>; raceDistanceKm: number }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip labelFormatter={dateTooltipLabel} formatter={(v) => [`${Number(v).toFixed(1)} km`, "Longest run"]} />
        <ReferenceLine y={raceDistanceKm * 0.5} stroke="orange" strokeDasharray="2 2" />
        <ReferenceLine y={raceDistanceKm * 0.67} stroke="#e74c3c" strokeDasharray="2 2" />
        <Bar dataKey="longest_run_km" fill="rgba(33,150,243,0.7)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function CategoryLoadChart({
  data,
}: {
  data: Array<{ week_start: string; running_load: number; volleyball_load: number; cricket_load: number; gym_load: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip labelFormatter={dateTooltipLabel} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="running_load" name="Running" stackId="load" fill={CATEGORY_COLOR.running} />
        <Bar dataKey="volleyball_load" name="Volleyball" stackId="load" fill={CATEGORY_COLOR.volleyball} />
        <Bar dataKey="cricket_load" name="Cricket" stackId="load" fill={CATEGORY_COLOR.cricket} />
        <Bar dataKey="gym_load" name="Gym" stackId="load" fill={CATEGORY_COLOR.gym} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
