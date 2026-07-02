# dashboard/tabs/training_load.py
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from db import get_all_race_events
import metrics
from shared import RACE_DISTANCE_KM


def render(conn) -> None:
    st.subheader("Weekly Mileage")

    vol_df = metrics.weekly_volume(conn)

    if not vol_df.empty:
        vol_df = vol_df.sort_values("week_start")
        vol_df["rolling_4w_avg"] = vol_df["run_distance_km"].rolling(4).mean()
        vol_df["run_time_h"] = vol_df["run_time_min"] / 60.0

        adh_df = metrics.plan_adherence(conn)
        mon_df = metrics.monthly_volume(conn)

        tab_dist, tab_time, tab_monthly = st.tabs(["Distance", "Time on Feet", "Monthly"])

        with tab_dist:
            fig = go.Figure()
            if not adh_df.empty:
                fig.add_trace(go.Bar(
                    x=adh_df["week_start_date"],
                    y=adh_df["planned_distance_km"],
                    name="Planned",
                    marker_color="rgba(100,149,237,0.3)",
                ))
            fig.add_trace(go.Bar(
                x=vol_df["week_start"],
                y=vol_df["run_distance_km"],
                name="Actual",
                marker_color="rgba(50,168,82,0.8)",
            ))
            fig.add_trace(go.Scatter(
                x=vol_df["week_start"],
                y=vol_df["rolling_4w_avg"],
                name="4-Week Average",
                mode="lines",
                line=dict(color="orange", width=2, dash="dot"),
            ))
            fig.update_layout(
                barmode="overlay",
                xaxis_title="Week",
                yaxis_title="Distance (km)",
                height=360,
                legend=dict(orientation="h"),
            )
            st.plotly_chart(fig, width="stretch")

        with tab_time:
            fig_time = go.Figure(go.Bar(
                x=vol_df["week_start"],
                y=vol_df["run_time_h"],
                marker_color="rgba(156,39,176,0.7)",
            ))
            fig_time.add_hline(y=8, line_dash="dot", line_color="orange", line_width=1,
                               annotation_text="8h/week build target", annotation_position="top right")
            fig_time.update_layout(
                title="Weekly Running Time (hours)",
                xaxis_title="Week",
                yaxis_title="Hours",
                height=360,
            )
            st.plotly_chart(fig_time, width="stretch")

        with tab_monthly:
            if not mon_df.empty:
                mon_sorted = mon_df.sort_values("month_start")
                fig_mon = go.Figure()
                fig_mon.add_trace(go.Bar(
                    x=mon_sorted["month_start"],
                    y=mon_sorted["run_distance_km"],
                    name="Distance (km)",
                    marker_color="rgba(50,168,82,0.8)",
                ))
                fig_mon.add_trace(go.Scatter(
                    x=mon_sorted["month_start"],
                    y=mon_sorted["run_time_h"],
                    name="Time (h)",
                    mode="lines+markers",
                    yaxis="y2",
                    line=dict(color="purple", width=2),
                ))
                fig_mon.update_layout(
                    title="Monthly Running Volume",
                    xaxis=dict(title="Month"),
                    yaxis=dict(title="Distance (km)"),
                    yaxis2=dict(title="Hours", overlaying="y", side="right"),
                    height=360,
                    legend=dict(orientation="h"),
                )
                st.plotly_chart(fig_mon, width="stretch")
    else:
        st.info("No activity data yet. Run `python src/sync.py` first.")

    st.divider()
    st.subheader("Long Run Progression")

    if not vol_df.empty:
        lr_df = vol_df[vol_df["longest_run_km"] > 0].copy()
        if not lr_df.empty:
            fig_lr = go.Figure(go.Bar(
                x=lr_df["week_start"],
                y=lr_df["longest_run_km"],
                marker_color="rgba(33,150,243,0.7)",
                name="Long Run",
            ))
            fig_lr.add_hline(
                y=RACE_DISTANCE_KM * 0.5, line_dash="dot", line_color="orange", line_width=1,
                annotation_text=f"50% of race ({RACE_DISTANCE_KM * 0.5:.0f} km)",
                annotation_position="top right",
            )
            fig_lr.add_hline(
                y=RACE_DISTANCE_KM * 0.67, line_dash="dot", line_color="red", line_width=1,
                annotation_text=f"67% of race ({RACE_DISTANCE_KM * 0.67:.0f} km)",
                annotation_position="top right",
            )
            fig_lr.update_layout(
                xaxis_title="Week",
                yaxis_title="Longest Run (km)",
                height=280,
            )
            st.plotly_chart(fig_lr, width="stretch")

    st.divider()
    st.subheader("Training Load & Fitness")

    tsb_df = metrics.ctl_atl_tsb_history(conn, since=metrics.TRAINING_START, until=metrics.TRAINING_END)
    if not tsb_df.empty:
        tsb_df = tsb_df.sort_values("day")
        fig_tsb = go.Figure()
        fig_tsb.add_trace(go.Scatter(
            x=tsb_df["day"], y=tsb_df["ctl"],
            name="CTL (Fitness)", mode="lines",
            line=dict(color="#2196F3", width=2),
        ))
        fig_tsb.add_trace(go.Scatter(
            x=tsb_df["day"], y=tsb_df["atl"],
            name="ATL (Fatigue)", mode="lines",
            line=dict(color="#f44336", width=2),
        ))
        fig_tsb.add_trace(go.Scatter(
            x=tsb_df["day"], y=tsb_df["tsb"],
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

    acwr_df = metrics.acwr_history(conn)
    ramp_df = metrics.weekly_ramp_rate(conn)

    col_acwr, col_ramp = st.columns(2)

    with col_acwr:
        if not acwr_df.empty:
            fig_acwr = px.line(
                acwr_df.sort_values("day"),
                x="day", y="acwr",
                title="ACWR History",
                labels={"acwr": "ACWR", "day": "Date"},
            )
            fig_acwr.add_hrect(
                y0=0.8, y1=1.3,
                fillcolor="green", opacity=0.12, line_width=0,
            )
            fig_acwr.add_hline(y=0.8, line_dash="dash", line_color="green", line_width=1,
                               annotation_text="0.8 floor", annotation_position="bottom right")
            fig_acwr.add_hline(y=1.3, line_dash="dash", line_color="orange", line_width=1,
                               annotation_text="1.3 caution", annotation_position="top right")
            fig_acwr.add_hline(y=1.5, line_dash="dot", line_color="red", line_width=1,
                               annotation_text="1.5 danger", annotation_position="top right")
            fig_acwr.update_layout(height=300)
            st.plotly_chart(fig_acwr, width="stretch")
            st.caption(
                "**ACWR** (Acute:Chronic Workload Ratio) = this week's load ÷ 4-week average. "
                "Think of it as: how hard am I training *right now* relative to what my body is used to? "
                "Below 0.8 = undertraining / deload. 0.8–1.3 = sweet spot. Above 1.5 = injury risk spikes sharply — "
                "the 'danger zone' in the research literature."
            )

    with col_ramp:
        if not ramp_df.empty:
            ramp_sorted = ramp_df.dropna(subset=["ramp_pct"]).sort_values("week_start").tail(16)
            bar_colors = [
                "#e74c3c" if abs(r) > 15 else ("#f39c12" if abs(r) > 10 else "#2ecc71")
                for r in ramp_sorted["ramp_pct"]
            ]
            fig_ramp = go.Figure(go.Bar(
                x=ramp_sorted["week_start"],
                y=ramp_sorted["ramp_pct"],
                marker_color=bar_colors,
            ))
            fig_ramp.add_hline(y=10, line_dash="dash", line_color="#f39c12", line_width=1,
                               annotation_text="+10%", annotation_position="top right")
            fig_ramp.add_hline(y=-10, line_dash="dash", line_color="#f39c12", line_width=1,
                               annotation_text="-10%", annotation_position="bottom right")
            fig_ramp.update_layout(
                title="Weekly Ramp Rate (last 16 weeks)",
                xaxis_title="Week",
                yaxis_title="Change (%)",
                height=300,
            )
            st.plotly_chart(fig_ramp, width="stretch")
            st.caption(
                "Week-on-week % change in distance. The 10% rule is a simplification — "
                "elite programs often ramp faster during base phase and cut sharply in taper. "
                "What matters: **don't spike two big weeks in a row** without a deload."
            )

    st.divider()
    st.subheader("Training Load by Category")

    cat_df = metrics.weekly_category_load(conn)
    if not cat_df.empty:
        cat_df = cat_df.sort_values("week_start")
        melt = cat_df.melt(
            id_vars="week_start",
            value_vars=["running_load", "volleyball_load", "cricket_load", "gym_load"],
            var_name="category",
            value_name="load",
        )
        melt["category"] = melt["category"].str.replace("_load", "", regex=False)

        fig_cat = px.bar(
            melt, x="week_start", y="load", color="category",
            title="Weekly Load by Category",
            labels={"load": "Load Score", "week_start": "Week", "category": "Category"},
            color_discrete_map={
                "running": "#2196F3",
                "volleyball": "#FF9800",
                "cricket": "#4CAF50",
                "gym": "#9C27B0",
            },
        )
        fig_cat.update_layout(height=350, legend=dict(orientation="h"))
        st.plotly_chart(fig_cat, width="stretch")
    else:
        st.info("No activity data yet.")
