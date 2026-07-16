"use client";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AcwrRow, CtlAtlTsbRow, EfficiencyFactorRow, MonotonyRow, RampRateRow } from "@/lib/metrics";

export function TsbChart({ data }: { data: CtlAtlTsbRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <Area dataKey="tsb" name="TSB (Form)" fill="#4CAF50" stroke="#4CAF50" fillOpacity={0.15} />
        <Line dataKey="ctl" name="CTL (Fitness)" stroke="#2196F3" dot={false} strokeWidth={2} />
        <Line dataKey="atl" name="ATL (Fatigue)" stroke="#f44336" dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function EfficiencyFactorChart({ data }: { data: EfficiencyFactorRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis dataKey="mean_ef" tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
        <Tooltip />
        <Scatter data={data} dataKey="mean_ef" fill="#2196F3" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function AcwrChart({ data }: { data: AcwrRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis tick={{ fontSize: 10 }} domain={[0, "auto"]} />
        <Tooltip />
        <ReferenceLine y={0.8} stroke="#4CAF50" strokeDasharray="4 4" />
        <ReferenceLine y={1.3} stroke="#f39c12" strokeDasharray="4 4" />
        <ReferenceLine y={1.5} stroke="#e74c3c" strokeDasharray="2 2" />
        <Line dataKey="acwr" stroke="#2196F3" dot={false} strokeWidth={2} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function RampRateChart({ data }: { data: RampRateRow[] }) {
  const recent = data.filter((r) => r.ramp_pct != null).slice(0, 112);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={recent}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <ReferenceLine y={10} stroke="#f39c12" strokeDasharray="4 4" />
        <ReferenceLine y={-10} stroke="#f39c12" strokeDasharray="4 4" />
        <Bar dataKey="ramp_pct" fill="#2ecc71" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MonotonyStrainChart({ data }: { data: MonotonyRow[] }) {
  const recent = data.filter((r) => r.monotony != null).slice(0, 112);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={recent}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
        <Tooltip />
        <Bar yAxisId="right" dataKey="strain" fill="rgba(244,67,54,0.5)" name="Strain" />
        <Line yAxisId="left" dataKey="monotony" stroke="#9C27B0" dot={false} strokeWidth={2} name="Monotony" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
