"use client";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortDate } from "@/lib/shared";
import { CHART_HEIGHT, CHART_MARGIN, SERIES, TOOLTIP_STYLE, Y_AXIS_WIDTH, dateTooltipLabel } from "./chartTheme";

const SERIES_CYCLE = Object.values(SERIES);

export function VolumeByWeekChart({ data }: { data: Array<{ week_start: string; total_volume_kg: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.primary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={dateTooltipLabel}
          formatter={(v) => [`${Math.round(Number(v))} kg`, "Volume"]}
        />
        <Bar dataKey="total_volume_kg" fill={SERIES.blue} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MuscleGroupVolumeChart({
  data,
  muscleGroups,
}: {
  data: Array<Record<string, string | number>>;
  muscleGroups: string[];
}) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.primary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={dateTooltipLabel}
          formatter={(v, name) => [`${Math.round(Number(v))} kg`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {muscleGroups.map((group, i) => (
          <Bar key={group} dataKey={group} name={group} stackId="muscle-groups" fill={SERIES_CYCLE[i % SERIES_CYCLE.length]} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function SessionsPerWeekChart({ data }: { data: Array<{ week_start: string; session_count: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} allowDecimals={false} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [`${v}`, "Sessions"]} />
        <Bar dataKey="session_count" fill={SERIES.green} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function BodyWeightChart({ data }: { data: Array<{ logged_date: string; weight_kg: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.primary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="logged_date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={dateTooltipLabel}
          formatter={(v) => [`${Number(v).toFixed(1)} kg`, "Weight"]}
        />
        <Line dataKey="weight_kg" name="Weight" stroke={SERIES.blue} dot strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ExerciseProgressionChart({
  data,
}: {
  data: Array<{ session_date: string; top_weight_kg: number; best_est_1rm: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.primary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="session_date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={dateTooltipLabel}
          formatter={(v, name) => [`${Number(v).toFixed(1)} kg`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line dataKey="top_weight_kg" name="Top weight" stroke={SERIES.blue} dot strokeWidth={2} />
        <Line dataKey="best_est_1rm" name="Est. 1RM" stroke={SERIES.magenta} dot strokeWidth={2} strokeDasharray="4 2" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
