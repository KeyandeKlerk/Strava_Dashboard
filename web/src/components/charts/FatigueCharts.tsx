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
import { shortDate } from "@/lib/shared";
import {
  CHART_HEIGHT,
  CHART_MARGIN,
  SERIES,
  STATUS,
  TOOLTIP_STYLE,
  Y_AXIS_WIDTH,
  dateTooltipLabel,
  scatterHitShape,
} from "./chartTheme";

export function TsbChart({ data }: { data: CtlAtlTsbRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.primary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="day" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} />
        <Area dataKey="tsb" name="TSB (Form)" fill={SERIES.green} stroke={SERIES.green} fillOpacity={0.15} />
        <Line dataKey="ctl" name="CTL (Fitness)" stroke={SERIES.blue} dot={false} strokeWidth={2} />
        <Line dataKey="atl" name="ATL (Fatigue)" stroke={SERIES.red} dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function EfficiencyFactorChart({ data }: { data: EfficiencyFactorRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ScatterChart margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis dataKey="mean_ef" width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} />
        <Scatter data={data} dataKey="mean_ef" fill={SERIES.blue} shape={scatterHitShape(SERIES.blue)} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function AcwrChart({ data }: { data: AcwrRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="day" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} domain={[0, "auto"]} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} />
        <ReferenceLine y={0.8} stroke={STATUS.good} strokeDasharray="4 4" />
        <ReferenceLine y={1.3} stroke={STATUS.warning} strokeDasharray="4 4" />
        <ReferenceLine y={1.5} stroke={STATUS.critical} strokeDasharray="2 2" />
        <Line dataKey="acwr" stroke={SERIES.blue} dot={false} strokeWidth={2} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function RampRateChart({ data }: { data: RampRateRow[] }) {
  const recent = data.filter((r) => r.ramp_pct != null);
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={recent} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [`${Number(v).toFixed(1)}%`, "Ramp"]} />
        <ReferenceLine y={10} stroke={STATUS.warning} strokeDasharray="4 4" />
        <ReferenceLine y={-10} stroke={STATUS.warning} strokeDasharray="4 4" />
        <Bar dataKey="ramp_pct" fill={SERIES.blue} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MonotonyChart({ data }: { data: MonotonyRow[] }) {
  const recent = data.filter((r) => r.monotony != null).slice(-112);
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={recent} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="day" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [Number(v).toFixed(2), "Monotony"]} />
        <Line dataKey="monotony" stroke={SERIES.violet} dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function StrainChart({ data }: { data: MonotonyRow[] }) {
  const recent = data.filter((r) => r.monotony != null).slice(-112);
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT.secondary}>
      <ComposedChart data={recent} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="day" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10 }} />
        <Tooltip {...TOOLTIP_STYLE} labelFormatter={dateTooltipLabel} formatter={(v) => [Number(v).toFixed(0), "Strain"]} />
        <Bar dataKey="strain" fill={SERIES.red} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
