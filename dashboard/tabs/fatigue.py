# dashboard/tabs/fatigue.py
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
