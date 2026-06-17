import sys
from pathlib import Path
from datetime import date

import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from db import get_conn, init_schema
import metrics

RACE_DATE = date(2027, 6, 13)
RACE_DISTANCE_KM = 90.0

st.set_page_config(
    page_title="Comrades 2027 Training",
    layout="wide",
)

conn = get_conn()
init_schema(conn)

# ── Header Row ────────────────────────────────────────────────────────────────
days_to_race = (RACE_DATE - date.today()).days
cur = metrics.current_week_stats(conn)

st.title("Comrades 2027 — Training Dashboard")
st.caption("Down Run · Pietermaritzburg → Durban · 13 June 2027")

c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("Days to Race", days_to_race)
c2.metric("This Week (km)", f"{cur['run_distance_km']:.1f}")
c3.metric("Planned (km)", f"{cur['planned_km']:.1f}" if cur["planned_km"] else "—")
c4.metric(
    "Plan Adherence",
    f"{cur['adherence_pct']:.0f}%" if cur["planned_km"] else "—",
)
c5.metric("Phase", cur["phase"])

st.divider()

# ── Mileage Trend ─────────────────────────────────────────────────────────────
st.subheader("Weekly Mileage")

vol_df = metrics.weekly_volume(conn)
if not vol_df.empty:
    vol_df = vol_df.sort_values("week_start")
    vol_df["rolling_4w_avg"] = vol_df["run_distance_km"].rolling(4).mean()

    adh_df = metrics.plan_adherence(conn)

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
        height=380,
        legend=dict(orientation="h"),
    )
    st.plotly_chart(fig, use_container_width=True)
else:
    st.info("No activity data yet. Run `python src/sync.py` first.")

st.divider()

# ── Load & Risk Panel ─────────────────────────────────────────────────────────
st.subheader("Load & Risk Indicators")

acwr_df = metrics.acwr_history(conn)
ramp_df = metrics.weekly_ramp_rate(conn)
mono_df = metrics.weekly_monotony(conn)
long_pct_df = metrics.long_run_pct(conn)


def _flag(value, low, high):
    if value is None or pd.isna(value):
        return "⚪"
    if low <= value <= high:
        return "🟢"
    if value < low * 0.9 or value > high * 1.15:
        return "🔴"
    return "🟡"


latest_acwr = acwr_df["acwr"].dropna().iloc[0] if not acwr_df.empty and acwr_df["acwr"].notna().any() else None
latest_ramp = ramp_df["ramp_pct"].dropna().iloc[0] if not ramp_df.empty and ramp_df["ramp_pct"].notna().any() else None
latest_mono = mono_df["monotony"].dropna().iloc[0] if not mono_df.empty and mono_df["monotony"].notna().any() else None
latest_long_pct = long_pct_df["long_run_pct"].dropna().iloc[0] if not long_pct_df.empty and long_pct_df["long_run_pct"].notna().any() else None

rc1, rc2, rc3, rc4 = st.columns(4)
with rc1:
    st.metric(
        f"{_flag(latest_acwr, 0.8, 1.3)} ACWR",
        f"{latest_acwr:.2f}" if latest_acwr is not None else "—",
    )
    st.caption("7-day load ÷ 4-week average. **0.8–1.3 = safe zone.** Above 1.5 spikes injury risk sharply.")
with rc2:
    st.metric(
        f"{_flag(latest_ramp, -10, 10)} Weekly Ramp",
        f"{latest_ramp:.1f}%" if latest_ramp is not None else "—",
    )
    st.caption("Week-on-week distance change. **Stay within ±10%** — jump more and injury risk doubles.")
with rc3:
    st.metric(
        f"{_flag(latest_mono, 0, 1.5)} Monotony",
        f"{latest_mono:.2f}" if latest_mono is not None else "—",
    )
    st.caption("Mean load ÷ SD. Above **2.0 = training too repetitive**, raising overuse risk. Vary hard/easy days.")
with rc4:
    st.metric(
        f"{_flag(latest_long_pct, 0, 35)} Long Run %",
        f"{latest_long_pct:.1f}%" if latest_long_pct is not None else "—",
    )
    st.caption("Longest run as % of weekly volume. Above **35% risks ITB** — spread load across more sessions.")

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
        st.plotly_chart(fig_acwr, use_container_width=True)

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
        st.plotly_chart(fig_ramp, use_container_width=True)

st.divider()

# ── Training Load by Category ─────────────────────────────────────────────────
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
    st.plotly_chart(fig_cat, use_container_width=True)
else:
    st.info("No activity data yet.")

st.divider()

# ── Aerobic Fitness Trend ─────────────────────────────────────────────────────
st.subheader("Aerobic Fitness")

z2_df = metrics.zone2_pace_trend(conn)

if not z2_df.empty:
    col_a, col_b = st.columns(2)

    with col_a:
        fig_z2 = px.scatter(
            z2_df,
            x="activity_date", y="pace_min_per_km",
            trendline="ols",
            title="Zone 2 Pace Trend (min/km) — lower is faster",
            labels={"pace_min_per_km": "Pace (min/km)", "activity_date": "Date"},
            hover_data=["name", "distance_km", "average_heartrate"],
        )
        fig_z2.update_layout(height=320)
        st.plotly_chart(fig_z2, use_container_width=True)

    with col_b:
        fig_decoup = px.bar(
            z2_df.tail(20),
            x="activity_date", y="decoupling_pct",
            title="Aerobic Decoupling % per Run (last 20)",
            labels={"decoupling_pct": "Decoupling %", "activity_date": "Date"},
            color="decoupling_pct",
            color_continuous_scale=["green", "yellow", "red"],
            range_color=[-5, 5],
        )
        fig_decoup.add_hline(y=5, line_dash="dash", line_color="red",
                             annotation_text=">5% = poor aerobic efficiency")
        fig_decoup.update_layout(height=320, showlegend=False)
        st.plotly_chart(fig_decoup, use_container_width=True)
else:
    st.info("No streams data yet. Run `python src/backfill.py` to fetch detailed metrics for long runs.")

st.divider()

# ── Comrades Milestones ───────────────────────────────────────────────────────
st.subheader("Comrades 2027 Milestones")

ms = metrics.comrades_milestones(conn, race_distance_km=RACE_DISTANCE_KM)
b2b_df = metrics.back_to_back_runs(conn)

m1, m2, m3, m4, m5, m6 = st.columns(6)
m1.metric(
    "Longest Run",
    f"{ms['longest_run_km']:.1f} km",
    f"{ms['longest_run_pct_race']:.0f}% of race",
)
m2.metric(
    "Total Elev Gain",
    f"{ms['total_gain_m']:,.0f} m",
    help="Cumulative elevation gain across all runs",
)
m3.metric(
    "Descent Practiced",
    f"{ms['total_descent_m']:.0f} m",
    f"{ms['descent_pct_practiced']:.0f}% of {ms['race_descent_m']:.0f}m target",
    help="Cumulative elevation loss from GPS streams. Comrades Down Run is ~1800m net descent.",
)
m4.metric(
    "Runs ≥30 km",
    str(ms["runs_30plus"]),
    f"{ms['runs_20plus']} runs ≥20 km",
)
m5.metric(
    "Best Back-to-Back",
    f"{ms['max_b2b_km']:.1f} km" if ms["max_b2b_km"] else "—",
    help="Combined distance of two consecutive long run days",
)
m6.metric(
    "Projected Finish",
    f"{ms['projected_finish_h']:.2f} h" if ms["projected_finish_h"] else "—",
    f"vs {ms['cutoff_h']:.0f}h cutoff",
    delta_color="inverse",
)

elev_col, band_col = st.columns([3, 2])

with elev_col:
    elev_df = metrics.weekly_elevation(conn)
    if not elev_df.empty:
        fig_elev = go.Figure(go.Bar(
            x=elev_df["week_start"],
            y=elev_df["weekly_gain_m"],
            marker_color="rgba(121,85,72,0.75)",
        ))
        fig_elev.update_layout(
            title="Weekly Elevation Gain (m)",
            xaxis_title="Week",
            yaxis_title="Gain (m)",
            height=300,
        )
        st.plotly_chart(fig_elev, use_container_width=True)

with band_col:
    proj_h = ms.get("projected_finish_h")
    st.markdown("**Comrades Finish Time Bands**")
    BANDS = [
        ("Wally Hayward", "Sub 6:00",           6.0),
        ("Gold",          "Sub 7:30",            7.5),
        ("Silver",        "Sub 9:00",            9.0),
        ("Bill Rowan",    "Sub 10:00",           10.0),
        ("Robert Mtshali","Sub 11:00",           11.0),
        ("Bronze",        "Sub 12:00 (cutoff)",  12.0),
    ]
    prev_h = 0.0
    for medal, label, cutoff_h in BANDS:
        on_track = proj_h is not None and prev_h <= proj_h < cutoff_h
        prefix = "🎯 " if on_track else "　 "
        text = f"**{medal}**" if on_track else medal
        st.markdown(f"{prefix}{text} — {label}")
        prev_h = cutoff_h
    if proj_h is None:
        st.caption("No projected time yet — need runs ≥25 km to estimate.")

if not b2b_df.empty:
    st.markdown("**Back-to-Back Long Runs**")
    st.dataframe(
        b2b_df.head(10),
        use_container_width=True,
        hide_index=True,
        column_config={
            "day1": st.column_config.DateColumn("Day 1"),
            "day2": st.column_config.DateColumn("Day 2"),
            "day1_km": st.column_config.NumberColumn("Day 1 (km)", format="%.1f"),
            "day2_km": st.column_config.NumberColumn("Day 2 (km)", format="%.1f"),
            "combined_km": st.column_config.NumberColumn("Combined (km)", format="%.1f"),
        },
    )

st.divider()

# ── Recent Activities ─────────────────────────────────────────────────────────
st.subheader("Recent Activities")

recent_df = metrics.recent_activities(conn, n=15)
if not recent_df.empty:
    st.dataframe(
        recent_df,
        use_container_width=True,
        hide_index=True,
        column_config={
            "date": st.column_config.DateColumn("Date"),
            "distance_km": st.column_config.NumberColumn("Dist (km)", format="%.1f"),
            "duration_min": st.column_config.NumberColumn("Time (min)", format="%.0f"),
            "elevation_m": st.column_config.NumberColumn("Elev (m)", format="%.0f"),
            "average_heartrate": st.column_config.NumberColumn("Avg HR", format="%.0f"),
            "load_score": st.column_config.NumberColumn("Load", format="%.0f"),
        },
    )
else:
    st.info("No activities to display.")

# ── Training Plan Editor ──────────────────────────────────────────────────────
with st.expander("Training Plan (click to expand & edit)", expanded=False):
    adh_df = metrics.plan_adherence(conn)

    if not adh_df.empty:
        st.dataframe(
            adh_df,
            use_container_width=True,
            hide_index=True,
            column_config={
                "week_start_date": st.column_config.DateColumn("Week Start"),
                "week_number": st.column_config.NumberColumn("Week #", format="%d"),
                "phase": "Phase",
                "planned_distance_km": st.column_config.NumberColumn("Planned (km)", format="%.1f"),
                "actual_distance_km": st.column_config.NumberColumn("Actual (km)", format="%.1f"),
                "adherence_pct": st.column_config.NumberColumn("Adherence %", format="%.1f"),
                "is_deload": st.column_config.CheckboxColumn("Deload?"),
            },
        )
    else:
        st.info("Training plan is empty. Populate the training_plan table to track adherence.")

    st.caption(
        "To populate the plan: call `db.upsert_training_plan_week()` from a script "
        "or import a CSV. The week-by-week targets are a separate follow-up task "
        "once real data is flowing."
    )
