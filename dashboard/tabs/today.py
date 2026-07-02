# dashboard/tabs/today.py
from datetime import date, timedelta

import streamlit as st

import metrics
from shared import flag, render_daily_sessions


def render(conn) -> None:
    acwr_df = metrics.acwr_history(conn)
    ramp_df = metrics.weekly_ramp_rate(conn)
    mono_df = metrics.weekly_monotony(conn)
    long_pct_df = metrics.long_run_pct(conn)

    latest_acwr = acwr_df["acwr"].dropna().iloc[0] if not acwr_df.empty and acwr_df["acwr"].notna().any() else None
    latest_ramp = ramp_df["ramp_pct"].dropna().iloc[0] if not ramp_df.empty and ramp_df["ramp_pct"].notna().any() else None
    latest_mono = mono_df["monotony"].dropna().iloc[0] if not mono_df.empty and mono_df["monotony"].notna().any() else None
    latest_long_pct = long_pct_df["long_run_pct"].dropna().iloc[0] if not long_pct_df.empty and long_pct_df["long_run_pct"].notna().any() else None

    rc1, rc2, rc3, rc4 = st.columns(4)
    with rc1:
        st.metric(
            f"{flag(latest_acwr, 0.8, 1.3)} ACWR",
            f"{latest_acwr:.2f}" if latest_acwr is not None else "—",
        )
        st.caption("7-day load ÷ 4-week average. **0.8–1.3 = safe zone.** Above 1.5 spikes injury risk sharply.")
    with rc2:
        st.metric(
            f"{flag(latest_ramp, -10, 10)} Weekly Ramp",
            f"{latest_ramp:.1f}%" if latest_ramp is not None else "—",
        )
        st.caption("Week-on-week distance change. **Stay within ±10%** — jump more and injury risk doubles.")
    with rc3:
        st.metric(
            f"{flag(latest_mono, 0, 1.5)} Monotony",
            f"{latest_mono:.2f}" if latest_mono is not None else "—",
        )
        st.caption("Mean load ÷ SD of daily loads this week. Above **2.0 = training too repetitive** — every day feels the same, which spikes overuse risk. Alternate hard and easy days to keep this below 1.5.")
    with rc4:
        st.metric(
            f"{flag(latest_long_pct, 0, 35)} Long Run %",
            f"{latest_long_pct:.1f}%" if latest_long_pct is not None else "—",
        )
        st.caption("Longest run as % of weekly volume. Above **35% risks ITB** — spread load across more sessions.")

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
