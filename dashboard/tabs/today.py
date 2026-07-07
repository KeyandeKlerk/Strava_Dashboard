# dashboard/tabs/today.py
from datetime import date, timedelta

import streamlit as st

import metrics
from shared import render_daily_sessions


def render(conn) -> None:
    st.info("🩺 Fatigue, overreaching, and structural-risk indicators have moved to the **Fatigue** tab.")

    st.divider()
    st.subheader("This Week's Plan")

    week_summary = metrics.weekly_completion_summary(conn)
    if week_summary.empty:
        st.info(
            "No plan loaded yet. Upload a CSV in the Plan & History tab, add a race via the "
            "Race Prep tab, or run `build_plan(conn, RACE_DATE, [])` from a Python console."
        )
        return

    today = date.today()
    starts = week_summary["week_start_date"].tolist()
    current_idx = 0
    for i, s in enumerate(starts):
        s_date = s.date() if hasattr(s, "date") else s
        if s_date <= today < s_date + timedelta(days=7):
            current_idx = i
            break

    week_nums = week_summary["week_number"].tolist()
    current_week_num = week_nums[current_idx]
    sel_row = week_summary.iloc[current_idx]

    done_runs  = int(sel_row["run_days_done"])
    total_runs = int(sel_row["run_days"])
    pct        = int(sel_row["completion_pct"] or 0)
    st.progress(pct / 100, text=f"{done_runs}/{total_runs} runs done · {pct}% complete")

    daily = metrics.daily_plan_for_week(conn, current_week_num)
    if daily.empty:
        st.info("No daily sessions yet for this week.")
    else:
        render_daily_sessions(daily, today)
