"use client";
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function WeeklyElevationChart({ data }: { data: Array<{ week_start: string; weekly_gain_m: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <Bar dataKey="weekly_gain_m" fill="rgba(121,85,72,0.75)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ElevationProfileChart({ data }: { data: Array<{ checkpoint: string; km: number; elevation_m: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="km" tick={{ fontSize: 10 }} type="number" domain={[0, "dataMax"]} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip labelFormatter={(v) => `km ${v}`} />
        <Area dataKey="elevation_m" fill="rgba(121,85,72,0.2)" stroke="rgba(121,85,72,0.8)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
