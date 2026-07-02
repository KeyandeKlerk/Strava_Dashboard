# dashboard/tabs/plan_history.py
from datetime import date, timedelta

import pandas as pd
import streamlit as st

from db import upsert_daily_session, sync_weekly_from_daily, correlate_activities_to_plan
import metrics
from shared import fmt_pace, render_daily_sessions, week_label


def render(conn) -> None:
    st.subheader("Long Run Log (≥20 km)")

    lr_hist_df = metrics.long_run_history(conn, min_km=20.0)
    if not lr_hist_df.empty:
        lr_hist_df = lr_hist_df.copy()
        lr_hist_df["pace_fmt"] = lr_hist_df["pace_min_km"].apply(fmt_pace)
        st.dataframe(
            lr_hist_df,
            width="stretch",
            hide_index=True,
            column_config={
                "activity_date": st.column_config.DateColumn("Date"),
                "name": "Name",
                "distance_km": st.column_config.NumberColumn("Dist (km)", format="%.1f"),
                "duration_min": st.column_config.NumberColumn("Time (min)", format="%.0f"),
                "elevation_gain_m": st.column_config.NumberColumn("Gain (m)", format="%.0f"),
                "avg_hr": st.column_config.NumberColumn("Avg HR", format="%.0f"),
                "pace_min_km": None,
                "pace_fmt": st.column_config.TextColumn("Pace (min/km)"),
                "decoupling_pct": st.column_config.NumberColumn("Decoupling %", format="%.1f"),
                "pct_time_z2": st.column_config.NumberColumn("Z2 %", format="%.0f"),
            },
        )
    else:
        st.info("No runs ≥20 km yet.")

    st.divider()
    st.subheader("Recent Activities")

    recent_df = metrics.recent_activities(conn, n=15)
    if not recent_df.empty:
        st.dataframe(
            recent_df,
            width="stretch",
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

    st.divider()
    st.subheader("Training Plan")

    with st.expander("Import plan from CSV", expanded=False):
        daily_cols = ["planned_date", "week_number", "day_of_week", "session_type",
                      "planned_distance_km", "intensity", "description", "is_quality"]
        st.caption(
            "Columns: `planned_date` (YYYY-MM-DD), `week_number`, `day_of_week`, "
            "`session_type`, `planned_distance_km`, `intensity`, `description`, "
            "`is_quality` (true/false). Multiple rows per date are supported (e.g. `sc` + `easy_run` on the same day). "
            "Existing rows are matched by `(planned_date, session_type)` and overwritten."
        )
        d_file = st.file_uploader("Daily sessions CSV", type="csv", key="upload_daily")
        if d_file:
            try:
                d_df = pd.read_csv(d_file)
                missing = [c for c in daily_cols if c not in d_df.columns]
                if missing:
                    st.error(f"Missing columns: {missing}")
                else:
                    d_df["is_quality"] = d_df["is_quality"].astype(str).str.lower().isin(["true", "1", "yes"])
                    d_df["planned_distance_km"] = pd.to_numeric(d_df["planned_distance_km"], errors="coerce").fillna(0.0)
                    for _, row in d_df.iterrows():
                        upsert_daily_session(conn, row.to_dict())
                    sync_weekly_from_daily(conn)
                    correlate_activities_to_plan(conn)
                    st.success(f"Loaded {len(d_df)} sessions and matched to Strava activities.")
            except Exception as e:
                st.error(f"Error: {e}")

    week_summary = metrics.weekly_completion_summary(conn)

    if week_summary.empty:
        st.info(
            "No plan loaded yet. Upload a CSV above, add a race via the Race Prep tab, "
            "or run `build_plan(conn, RACE_DATE, [])` from a Python console."
        )
        return

    today = date.today()

    labels    = [week_label(r) for _, r in week_summary.iterrows()]
    week_nums = week_summary["week_number"].tolist()

    starts = week_summary["week_start_date"].tolist()
    default_idx = 0
    for i, s in enumerate(starts):
        s_date = s.date() if hasattr(s, "date") else s
        if s_date <= today < s_date + timedelta(days=7):
            default_idx = i
            break

    col_sel, col_prog = st.columns([3, 2])

    with col_sel:
        selected_idx = st.selectbox(
            "Week",
            options=list(range(len(labels))),
            format_func=lambda i: labels[i],
            index=default_idx,
            label_visibility="collapsed",
        )

    selected_week_num = week_nums[selected_idx]
    sel_row = week_summary.iloc[selected_idx]

    with col_prog:
        done_runs  = int(sel_row["run_days_done"])
        total_runs = int(sel_row["run_days"])
        pct        = int(sel_row["completion_pct"] or 0)
        st.progress(pct / 100, text=f"{done_runs}/{total_runs} runs done · {pct}% complete")

    with st.expander("All weeks — overview", expanded=False):
        disp = week_summary[
            ["week_number", "week_start_date", "phase", "planned_distance_km",
             "run_days_done", "run_days", "completion_pct", "is_deload"]
        ].copy()
        disp.columns = ["Week", "Mon", "Phase", "Plan km",
                        "Runs done", "Run days", "Done %", "Deload"]
        ov_event = st.dataframe(
            disp,
            width="stretch",
            hide_index=True,
            on_select="rerun",
            selection_mode="single-row",
            column_config={
                "Mon":     st.column_config.DateColumn("Week start"),
                "Plan km": st.column_config.NumberColumn(format="%.0f"),
                "Done %":  st.column_config.ProgressColumn(min_value=0, max_value=100, format="%.0f%%"),
                "Deload":  st.column_config.CheckboxColumn(),
            },
        )
        sel_rows = ov_event.selection.rows if ov_event and ov_event.selection else []
        if sel_rows:
            drill_wnum = int(week_summary.iloc[sel_rows[0]]["week_number"])
            drill_label = week_label(week_summary.iloc[sel_rows[0]])
            st.markdown(f"**{drill_label}**")
            drill_daily = metrics.daily_plan_for_week(conn, drill_wnum)
            if drill_daily.empty:
                st.caption("No sessions loaded for this week.")
            else:
                render_daily_sessions(drill_daily, today)

    daily = metrics.daily_plan_for_week(conn, selected_week_num)

    if daily.empty:
        st.info("No daily sessions yet — run `build_plan` from the Race Prep tab above.")
    else:
        render_daily_sessions(daily, today)
