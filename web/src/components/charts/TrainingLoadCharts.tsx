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
import {
  CHART_HEIGHT,
  CHART_MARGIN,
  SERIES,
  STATUS,
  TOOLTIP_STYLE,
  Y_AXIS_WIDTH,
  dateTooltipLabel,
  monthTooltipLabel,
} from "./chartTheme";

// Four distinct activity types stacked in one chart — true categorical
// identity, so each gets its own palette slot (1-4, the validated
// all-pairs-safe subset for a 4-series stack).
const CATEGORY_COLOR: Record<string, string> = {
  running: SERIES.blue,
  volleyball: SERIES.green,
  cricket: SERIES.magenta,
  gym: SERIES.yellow,
};

export function WeeklyDistanceChart({
  data,
}: {
  data: Array<{ week_start: string; planned_km: number; actual_km: number; rolling_4w_avg: number | null }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.primary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v, name) => [`${Number(v).toFixed(1)} km`, name]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="planned_km" name="Planned" fill={SERIES.aqua} />
        <Bar dataKey="actual_km" name="Actual" fill={SERIES.blue} />
        <Line dataKey="rolling_4w_avg" name="4-Week Avg" stroke={SERIES.orange} strokeDasharray="4 2" dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function TimeOnFeetChart({ data }: { data: Array<{ week_start: string; run_time_h: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [`${Number(v).toFixed(1)} h`, "Time"]} />
        <ReferenceLine y={8} stroke={STATUS.warning} strokeDasharray="2 2" />
        <Bar dataKey="run_time_h" fill={SERIES.blue} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MonthlyDistanceChart({ data }: { data: Array<{ month_start: string; run_distance_km: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="month_start" tickFormatter={shortMonth} tick={{ fontSize: 10 }} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={monthTooltipLabel} formatter={(v) => [`${Number(v).toFixed(1)} km`, "Distance"]} />
        <Bar dataKey="run_distance_km" fill={SERIES.blue} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MonthlyTimeChart({ data }: { data: Array<{ month_start: string; run_time_h: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="month_start" tickFormatter={shortMonth} tick={{ fontSize: 10 }} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={monthTooltipLabel} formatter={(v) => [`${Number(v).toFixed(1)} h`, "Time"]} />
        <Line dataKey="run_time_h" stroke={SERIES.blue} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function LongRunProgressionChart({
  data,
  raceDistanceKm,
}: {
  data: Array<{ week_start: string; longest_run_km: number }>;
  raceDistanceKm?: number | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [`${Number(v).toFixed(1)} km`, "Longest run"]} />
        {raceDistanceKm != null && (
          <>
            <ReferenceLine y={raceDistanceKm * 0.5} stroke={STATUS.warning} strokeDasharray="2 2" />
            <ReferenceLine y={raceDistanceKm * 0.67} stroke={STATUS.critical} strokeDasharray="2 2" />
          </>
        )}
        <Bar dataKey="longest_run_km" fill={SERIES.blue} />
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
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="running_load" name="Running" stackId="load" fill={CATEGORY_COLOR.running} />
        <Bar dataKey="volleyball_load" name="Volleyball" stackId="load" fill={CATEGORY_COLOR.volleyball} />
        <Bar dataKey="cricket_load" name="Cricket" stackId="load" fill={CATEGORY_COLOR.cricket} />
        <Bar dataKey="gym_load" name="Gym" stackId="load" fill={CATEGORY_COLOR.gym} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
