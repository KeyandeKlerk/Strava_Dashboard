"use client";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

const ZONE_COLOR: Record<string, string> = {
  z1_min: "#4fc3f7",
  z2_min: "#66bb6a",
  z3_min: "#ffa726",
  z4_min: "#ef5350",
  z5_min: "#ab47bc",
};

export function ZoneTimeChart({
  data,
}: {
  data: Array<{ week_start: string; z1_min: number; z2_min: number; z3_min: number; z4_min: number; z5_min: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {Object.entries(ZONE_COLOR).map(([key, color]) => (
          <Bar key={key} dataKey={key} name={key.replace("_min", "").toUpperCase()} stackId="zones" fill={color} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function EasyPctChart({ data }: { data: Array<{ week_start: string; easy_pct: number | null }> }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={data.filter((d) => d.easy_pct != null)}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
        <Tooltip />
        <ReferenceLine y={80} stroke="green" strokeDasharray="4 2" />
        <Line dataKey="easy_pct" stroke="#66bb6a" dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function PaceTrendChart({ data }: { data: Array<{ activity_date: string; pace_min_per_km: number | null }> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="activity_date" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis dataKey="pace_min_per_km" tick={{ fontSize: 10 }} reversed domain={["auto", "auto"]} />
        <Tooltip />
        <Scatter data={data.filter((d) => d.pace_min_per_km != null)} dataKey="pace_min_per_km" fill="#2196F3" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function decouplingColor(v: number): string {
  if (v <= 0) return "#2ecc71";
  if (v >= 5) return "#e74c3c";
  return "#f39c12";
}

export function DecouplingChart({ data }: { data: Array<{ activity_date: string; decoupling_pct: number | null }> }) {
  const recent = data.filter((d) => d.decoupling_pct != null).slice(-20);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={recent}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="activity_date" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <ReferenceLine y={5} stroke="#e74c3c" strokeDasharray="4 2" />
        <Bar dataKey="decoupling_pct">
          {recent.map((d, i) => (
            <Cell key={i} fill={decouplingColor(d.decoupling_pct ?? 0)} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function QualityScoreChart({ data }: { data: Array<{ activity_date: string; quality_score: number; distance_km: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="activity_date" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis dataKey="quality_score" tick={{ fontSize: 10 }} domain={[0, 100]} />
        <ZAxis dataKey="distance_km" range={[40, 200]} />
        <Tooltip />
        <Scatter data={data}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.quality_score >= 70 ? "#2ecc71" : d.quality_score >= 40 ? "#f39c12" : "#e74c3c"} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
