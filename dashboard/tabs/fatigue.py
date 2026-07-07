# dashboard/tabs/fatigue.py
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from db import get_all_race_events
import metrics
from shared import flag


def render(conn) -> None:
    st.subheader("Form & Freshness")

    tsb_df = metrics.ctl_atl_tsb_history(conn, since=metrics.TRAINING_START, until=metrics.TRAINING_END)
    ef_df = metrics.weekly_efficiency_factor(conn)

    latest_tsb = float(tsb_df["tsb"].iloc[-1]) if not tsb_df.empty else None

    latest_ef = None
    ef_trend_arrow = "→"
    if not ef_df.empty:
        ef_sorted_for_metric = ef_df.sort_values("week_start")
        latest_ef = float(ef_sorted_for_metric["mean_ef"].iloc[-1])
        recent = ef_sorted_for_metric["mean_ef"].tail(4)
        if len(recent) >= 2:
            if recent.iloc[-1] > recent.iloc[0]:
                ef_trend_arrow = "↑"
            elif recent.iloc[-1] < recent.iloc[0]:
                ef_trend_arrow = "↓"

    fc1, fc2 = st.columns(2)
    with fc1:
        st.metric(
            f"{flag(latest_tsb, -10, 10)} TSB (Form)",
            f"{latest_tsb:.1f}" if latest_tsb is not None else "—",
        )
        st.caption("CTL − ATL. **Target +5 to +15 on race day.** Negative = fatigued/building.")
    with fc2:
        st.metric(
            f"{ef_trend_arrow} Efficiency Factor",
            f"{latest_ef:.3f}" if latest_ef is not None else "—",
        )
        st.caption(
            "Speed ÷ heart rate, weekly mean. Rising at stable load = good aerobic adaptation; "
            "falling despite stable load = early fatigue signal."
        )

    if not tsb_df.empty:
        tsb_sorted = tsb_df.sort_values("day")
        fig_tsb = go.Figure()
        fig_tsb.add_trace(go.Scatter(
            x=tsb_sorted["day"], y=tsb_sorted["ctl"],
            name="CTL (Fitness)", mode="lines",
            line=dict(color="#2196F3", width=2),
        ))
        fig_tsb.add_trace(go.Scatter(
            x=tsb_sorted["day"], y=tsb_sorted["atl"],
            name="ATL (Fatigue)", mode="lines",
            line=dict(color="#f44336", width=2),
        ))
        fig_tsb.add_trace(go.Scatter(
            x=tsb_sorted["day"], y=tsb_sorted["tsb"],
            name="TSB (Form)", mode="lines",
            fill="tozeroy",
            line=dict(color="#4CAF50", width=1),
            yaxis="y2",
            fillcolor="rgba(76,175,80,0.15)",
        ))
        for event in get_all_race_events(conn):
            fig_tsb.add_vline(
                x=str(event["race_date"]),
                line_dash="dash", line_color="orange", line_width=1,
                annotation_text=event["name"][:12],
                annotation_position="top",
            )
        fig_tsb.update_layout(
            title="CTL / ATL / TSB — Fitness, Fatigue & Form",
            height=360,
            yaxis=dict(title="Load units (CTL/ATL)"),
            yaxis2=dict(title="Form (TSB)", overlaying="y", side="right", zeroline=True),
            legend=dict(orientation="h"),
        )
        st.plotly_chart(fig_tsb, width="stretch")
        st.caption(
            "**CTL (blue)** — Chronic Training Load: 42-day exponential average of daily load. Your long-term fitness base. "
            "Takes 6–8 weeks to move meaningfully — don't expect overnight gains.  \n"
            "**ATL (red)** — Acute Training Load: 7-day exponential average. Reflects current fatigue. "
            "Spikes after hard blocks, drops fast during rest weeks.  \n"
            "**TSB (green area)** — Training Stress Balance (Form) = CTL − ATL. "
            "Negative = fatigued/building. Positive = fresh/peaked. "
            "**Target TSB +5 to +15 on race day** — too positive means you detrained, too negative means you're buried."
        )
    else:
        st.info("No training load data yet. Run sync to populate fitness history.")

    if not ef_df.empty:
        ef_sorted = ef_df.sort_values("week_start")
        fig_ef = px.line(
            ef_sorted, x="week_start", y="mean_ef",
            trendline="ols",
            title="Weekly Aerobic Efficiency Factor (speed ÷ HR)",
            labels={"mean_ef": "EF", "week_start": "Week"},
        )
        fig_ef.update_layout(height=280)
        st.plotly_chart(fig_ef, width="stretch")
    else:
        st.info("Not enough runs with heart rate data yet to compute Efficiency Factor.")

    st.divider()
    st.subheader("Overreaching Risk")

    acwr_df = metrics.acwr_history(conn)
    ramp_df = metrics.weekly_ramp_rate(conn)
    mono_df = metrics.weekly_monotony(conn)

    latest_acwr = acwr_df["acwr"].dropna().iloc[0] if not acwr_df.empty and acwr_df["acwr"].notna().any() else None
    latest_ramp = ramp_df["ramp_pct"].dropna().iloc[0] if not ramp_df.empty and ramp_df["ramp_pct"].notna().any() else None
    latest_mono = mono_df["monotony"].dropna().iloc[0] if not mono_df.empty and mono_df["monotony"].notna().any() else None

    strain_flag = "⚪"
    latest_strain = None
    if not mono_df.empty and mono_df["strain"].notna().any():
        mono_for_strain = mono_df.sort_values("week_start").copy()
        mono_for_strain["strain_4w_avg"] = mono_for_strain["strain"].rolling(4).mean().shift(1)
        strain_row = mono_for_strain.dropna(subset=["strain"]).iloc[-1]
        latest_strain = float(strain_row["strain"])
        baseline = strain_row["strain_4w_avg"]
        if pd.isna(baseline) or baseline <= 0:
            strain_flag = "⚪"
        elif latest_strain <= baseline:
            strain_flag = "🟢"
        elif latest_strain <= baseline * 2:
            strain_flag = "🟡"
        else:
            strain_flag = "🔴"

    rc1, rc2, rc3, rc4 = st.columns(4)
    with rc1:
        st.metric(f"{flag(latest_acwr, 0.8, 1.3)} ACWR", f"{latest_acwr:.2f}" if latest_acwr is not None else "—")
        st.caption("7-day load ÷ 4-week average. **0.8–1.3 = safe zone.** Above 1.5 spikes injury risk sharply.")
    with rc2:
        st.metric(f"{flag(latest_ramp, -10, 10)} Weekly Ramp", f"{latest_ramp:.1f}%" if latest_ramp is not None else "—")
        st.caption("Week-on-week distance change. **Stay within ±10%** — jump more and injury risk doubles.")
    with rc3:
        st.metric(f"{flag(latest_mono, 0, 1.5)} Monotony", f"{latest_mono:.2f}" if latest_mono is not None else "—")
        st.caption("Mean load ÷ SD of daily loads. Above **2.0 = training too repetitive.**")
    with rc4:
        st.metric(f"{strain_flag} Strain", f"{latest_strain:.0f}" if latest_strain is not None else "—")
        st.caption("Monotony × weekly load. Flagged relative to your **trailing 4-week average** — no universal threshold exists.")

    col_acwr, col_ramp = st.columns(2)
    with col_acwr:
        if not acwr_df.empty:
            fig_acwr = px.line(
                acwr_df.sort_values("day"), x="day", y="acwr",
                title="ACWR History", labels={"acwr": "ACWR", "day": "Date"},
            )
            fig_acwr.add_hrect(y0=0.8, y1=1.3, fillcolor="green", opacity=0.12, line_width=0)
            fig_acwr.add_hline(y=0.8, line_dash="dash", line_color="green", line_width=1,
                               annotation_text="0.8 floor", annotation_position="bottom right")
            fig_acwr.add_hline(y=1.3, line_dash="dash", line_color="orange", line_width=1,
                               annotation_text="1.3 caution", annotation_position="top right")
            fig_acwr.add_hline(y=1.5, line_dash="dot", line_color="red", line_width=1,
                               annotation_text="1.5 danger", annotation_position="top right")
            fig_acwr.update_layout(height=300)
            st.plotly_chart(fig_acwr, width="stretch")

    with col_ramp:
        if not ramp_df.empty:
            ramp_sorted = ramp_df.dropna(subset=["ramp_pct"]).sort_values("week_start").tail(16)
            bar_colors = [
                "#e74c3c" if abs(r) > 15 else ("#f39c12" if abs(r) > 10 else "#2ecc71")
                for r in ramp_sorted["ramp_pct"]
            ]
            fig_ramp = go.Figure(go.Bar(x=ramp_sorted["week_start"], y=ramp_sorted["ramp_pct"], marker_color=bar_colors))
            fig_ramp.add_hline(y=10, line_dash="dash", line_color="#f39c12", line_width=1,
                               annotation_text="+10%", annotation_position="top right")
            fig_ramp.add_hline(y=-10, line_dash="dash", line_color="#f39c12", line_width=1,
                               annotation_text="-10%", annotation_position="bottom right")
            fig_ramp.update_layout(title="Weekly Ramp Rate (last 16 weeks)", xaxis_title="Week", yaxis_title="Change (%)", height=300)
            st.plotly_chart(fig_ramp, width="stretch")

    if not mono_df.empty:
        mono_sorted = mono_df.dropna(subset=["monotony"]).sort_values("week_start").tail(16)
        fig_combo = go.Figure()
        fig_combo.add_trace(go.Bar(
            x=mono_sorted["week_start"], y=mono_sorted["strain"],
            name="Strain", marker_color="rgba(244,67,54,0.5)", yaxis="y2",
        ))
        fig_combo.add_trace(go.Scatter(
            x=mono_sorted["week_start"], y=mono_sorted["monotony"],
            name="Monotony", mode="lines+markers", line=dict(color="#9C27B0", width=2),
        ))
        fig_combo.update_layout(
            title="Monotony & Strain (last 16 weeks)",
            yaxis=dict(title="Monotony"),
            yaxis2=dict(title="Strain", overlaying="y", side="right"),
            height=300,
            legend=dict(orientation="h"),
        )
        st.plotly_chart(fig_combo, width="stretch")
        st.caption(
            "**Monotony** = mean ÷ SD of daily load (low variety = high monotony). "
            "**Strain** = monotony × weekly load. Watch for weeks where both spike together — "
            "that combination is Foster's classic overtraining-risk signature."
        )
