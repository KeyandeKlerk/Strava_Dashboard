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
import { shortDate } from "@/lib/shared";
import {
  CHART_HEIGHT,
  CHART_MARGIN,
  SEQUENTIAL_BLUE,
  SERIES,
  STATUS,
  TOOLTIP_STYLE,
  Y_AXIS_WIDTH,
  dateTooltipLabel,
  scatterHitShape,
} from "./chartTheme";

// Z1 (easiest) -> Z5 (hardest) is an ordered magnitude, not arbitrary
// identity, so it takes one sequential hue with monotone lightness steps
// rather than distinct categorical colors.
const ZONE_COLOR: Record<string, string> = {
  z1_min: SEQUENTIAL_BLUE[0],
  z2_min: SEQUENTIAL_BLUE[1],
  z3_min: SEQUENTIAL_BLUE[2],
  z4_min: SEQUENTIAL_BLUE[3],
  z5_min: SEQUENTIAL_BLUE[4],
};

export function ZoneTimeChart({
  data,
}: {
  data: Array<{ week_start: string; z1_min: number; z2_min: number; z3_min: number; z4_min: number; z5_min: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.primary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v, name) => [`${Number(v).toFixed(0)} min`, name]} />
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
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={data.filter((d) => d.easy_pct != null)} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} domain={[0, 100]} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [`${Number(v).toFixed(0)}%`, "Easy"]} />
        <ReferenceLine y={80} stroke={STATUS.good} strokeDasharray="4 2" />
        <Line dataKey="easy_pct" stroke={SERIES.blue} dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function PaceTrendChart({ data }: { data: Array<{ activity_date: string; pace_min_per_km: number | null }> }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ScatterChart margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="activity_date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis dataKey="pace_min_per_km" width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} reversed domain={["auto", "auto"]} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [`${Number(v).toFixed(2)} min/km`, "Pace"]} />
        <Scatter
          data={data.filter((d) => d.pace_min_per_km != null)}
          dataKey="pace_min_per_km"
          fill={SERIES.blue}
          shape={scatterHitShape(SERIES.blue)}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// Shared by DecouplingChart and QualityScoreChart's semantic (non-series)
// coloring, and by their pages' ChartCard `legend` prop — keep these in sync
// with each other so the legend swatches always match the mark colors. These
// are genuine status encodings (good/borderline/bad), so they wear the fixed
// status palette, not a categorical series slot.
export const SEMANTIC_COLOR = { good: STATUS.good, borderline: STATUS.warning, bad: STATUS.critical };

function decouplingColor(v: number): string {
  if (v <= 0) return SEMANTIC_COLOR.good;
  if (v >= 5) return SEMANTIC_COLOR.bad;
  return SEMANTIC_COLOR.borderline;
}

export function DecouplingChart({ data }: { data: Array<{ activity_date: string; decoupling_pct: number | null }> }) {
  const recent = data.filter((d) => d.decoupling_pct != null).slice(-20);
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={recent} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="activity_date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [`${Number(v).toFixed(1)}%`, "Decoupling"]} />
        <ReferenceLine y={5} stroke={STATUS.critical} strokeDasharray="4 2" />
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
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ScatterChart margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="activity_date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis dataKey="quality_score" width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} domain={[0, 100]} />
        <ZAxis dataKey="distance_km" range={[40, 200]} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} />
        <Scatter data={data}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.quality_score >= 70 ? SEMANTIC_COLOR.good : d.quality_score >= 40 ? SEMANTIC_COLOR.borderline : SEMANTIC_COLOR.bad}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
