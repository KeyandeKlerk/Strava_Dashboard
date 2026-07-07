# dashboard/app.py
import sys
from pathlib import Path
from datetime import date, timedelta

import streamlit as st

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from db import get_conn, init_schema
import metrics
from highlights import build_highlights
from shared import RACE_DATE, RACE_DISTANCE_KM
from tabs import today, fatigue, training_load, aerobic, race_prep, plan_history

st.set_page_config(
    page_title="Comrades 2027 Training",
    layout="wide",
)

conn = get_conn()
init_schema(conn)

# ── Header Row ────────────────────────────────────────────────────────────────
FILTER_MIN = date(2026, 1, 1)

days_to_race = (RACE_DATE - date.today()).days
cur = metrics.current_week_stats(conn)

title_col, filter_col = st.columns([3, 2])
with title_col:
    st.title("Comrades 2027 — Training Dashboard")
    st.caption("Down Run · Pietermaritzburg → Durban · 13 June 2027")

with filter_col:
    st.markdown("<div style='padding-top:18px'></div>", unsafe_allow_html=True)
    since = st.date_input(
        "Show from",
        value=FILTER_MIN,
        min_value=FILTER_MIN,
        max_value=date.today(),
        format="YYYY-MM-DD",
    )

if not isinstance(since, date):
    since = FILTER_MIN
until = date.today()

metrics.TRAINING_START = since.isoformat()
metrics.TRAINING_END   = until.isoformat()

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

# ── Highlights ────────────────────────────────────────────────────────────────
tsb_df  = metrics.ctl_atl_tsb_history(conn, since=metrics.TRAINING_START, until=metrics.TRAINING_END)
ramp_df = metrics.weekly_ramp_rate(conn)
ms      = metrics.comrades_milestones(conn, race_distance_km=RACE_DISTANCE_KM)
lrq_df  = metrics.long_run_quality_scores(conn)
shoe_df = metrics.shoe_mileage(conn)

latest_tsb  = float(tsb_df["tsb"].iloc[-1]) if not tsb_df.empty else None
latest_ramp = (
    float(ramp_df["ramp_pct"].dropna().iloc[0])
    if not ramp_df.empty and ramp_df["ramp_pct"].notna().any()
    else None
)

week_summary_hl = metrics.weekly_completion_summary(conn)
week_completion_pct = None
if not week_summary_hl.empty:
    today_hl = date.today()
    for _, wrow in week_summary_hl.iterrows():
        ws = wrow["week_start_date"]
        ws_date = ws.date() if hasattr(ws, "date") else ws
        if ws_date <= today_hl < ws_date + timedelta(days=7):
            week_completion_pct = float(wrow["completion_pct"] or 0)
            break

hl_text, hl_style = build_highlights(
    ramp_pct=latest_ramp,
    tsb=latest_tsb,
    projected_h=ms.get("projected_finish_h"),
    days_to_race=days_to_race,
    lr_quality_df=lrq_df,
    shoe_df=shoe_df,
    week_completion_pct=week_completion_pct,
)
if hl_style == "success":
    st.success(hl_text)
elif hl_style == "warning":
    st.warning(hl_text)
else:
    st.info(hl_text)

# ── Tabs ──────────────────────────────────────────────────────────────────────
tab_today, tab_fatigue, tab_load, tab_aerobic, tab_race, tab_plan = st.tabs(
    ["Today", "Fatigue", "Training Load", "Aerobic Performance", "Race Prep", "Plan & History"]
)

with tab_today:
    today.render(conn)

with tab_fatigue:
    fatigue.render(conn)

with tab_load:
    training_load.render(conn)

with tab_aerobic:
    aerobic.render(conn)

with tab_race:
    race_prep.render(conn)

with tab_plan:
    plan_history.render(conn)
