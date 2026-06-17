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
rc1.metric(
    f"{_flag(latest_acwr, 0.8, 1.3)} ACWR",
    f"{latest_acwr:.2f}" if latest_acwr is not None else "—",
    help="Acute:Chronic Workload Ratio. Optimal: 0.8–1.3",
)
rc2.metric(
    f"{_flag(latest_ramp, -10, 10)} Weekly Ramp",
    f"{latest_ramp:.1f}%" if latest_ramp is not None else "—",
    help="Week-over-week % change in running distance. Flag if >10%",
)
rc3.metric(
    "Monotony",
    f"{latest_mono:.2f}" if latest_mono is not None else "—",
    help="Mean daily load ÷ SD. Higher = less variation in training stimulus",
)
rc4.metric(
    f"{_flag(latest_long_pct, 0, 35)} Long Run %",
    f"{latest_long_pct:.1f}%" if latest_long_pct is not None else "—",
    help="Long run as % of weekly distance. Flag if >35% (ITB risk)",
)

if not acwr_df.empty:
    fig_acwr = px.line(
        acwr_df.sort_values("day"),
        x="day", y="acwr",
        title="ACWR History",
        labels={"acwr": "ACWR", "day": "Date"},
    )
    fig_acwr.add_hline(y=0.8, line_dash="dash", line_color="green", annotation_text="0.8 lower")
    fig_acwr.add_hline(y=1.3, line_dash="dash", line_color="red", annotation_text="1.3 upper")
    fig_acwr.update_layout(height=280)
    st.plotly_chart(fig_acwr, use_container_width=True)

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
