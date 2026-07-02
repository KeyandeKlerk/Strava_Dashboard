# dashboard/tabs/race_prep.py
from datetime import date

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from db import get_all_race_events, upsert_race_event
from periodization import build_plan
import metrics
from shared import BANDS, RACE_DATE, RACE_DISTANCE_KM, fmt_pace

_ELEV_PROFILE = [
    ("Pietermaritzburg",  0.0,  750),
    ("Camperdown",        24.0, 700),
    ("Cato Ridge",        36.0, 820),
    ("Drummond",          46.0, 660),
    ("Botha's Hill",      60.0, 560),
    ("Hillcrest",         68.0, 450),
    ("Pinetown",          76.0, 180),
    ("45th Cutting",      84.0,  60),
    ("Durban",            90.0,   5),
]


def render(conn) -> None:
    st.subheader("Race Calendar")

    race_events = get_all_race_events(conn)

    if race_events:
        rows = []
        for event in race_events:
            status = "upcoming"
            if event["strava_activity_id"]:
                status = "analysed"
            elif event["race_date"] < date.today():
                status = "completed"
            rows.append({
                "Name":       event["name"],
                "Date":       event["race_date"],
                "Dist (km)":  event["distance_km"],
                "Priority":   event["priority"],
                "Target (h)": f"{event['target_finish_h']:.1f}" if event["target_finish_h"] else "—",
                "Status":     status,
            })
        st.dataframe(
            pd.DataFrame(rows),
            width="stretch",
            hide_index=True,
            column_config={
                "Date": st.column_config.DateColumn("Date"),
                "Dist (km)": st.column_config.NumberColumn(format="%.1f"),
            },
        )

        analysed = [r for r in race_events if r["strava_activity_id"]]
        if analysed:
            for ar in analysed:
                with st.expander(f"Race analysis — {ar['name']} ({ar['race_date']})"):
                    ra = conn.execute(
                        "SELECT avg_pace_min_km, comrades_projection_h, computed_at FROM race_analysis WHERE race_event_id = ?",
                        [ar["id"]],
                    ).fetchone()
                    if ra:
                        ra_c1, ra_c2, ra_c3 = st.columns(3)
                        ra_c1.metric("Avg Pace", f"{fmt_pace(ra[0])} min/km" if ra[0] else "—")
                        ra_c2.metric("Comrades Projection", f"{ra[1]:.2f} h" if ra[1] else "—")
                        ra_c3.metric("Analysed", str(ra[2])[:10] if ra[2] else "—")
                    else:
                        st.info("No analysis data yet — run sync after the race.")
    else:
        st.info("No races scheduled yet. Add one below.")

    with st.expander("Add race"):
        with st.form("add_race_form"):
            f_name     = st.text_input("Race name", placeholder="e.g. Two Oceans Ultra")
            f_date     = st.date_input("Race date", value=date.today())
            f_dist     = st.number_input("Distance (km)", min_value=1.0, max_value=250.0, value=42.2, step=0.1)
            f_priority = st.selectbox("Priority", ["A", "B"])
            f_target   = st.number_input("Target finish (h)", min_value=0.0, max_value=24.0, value=0.0, step=0.25,
                                          help="0 = no target set")
            f_notes    = st.text_area("Notes", placeholder="Course notes, goal, etc.")
            submitted  = st.form_submit_button("Save & rebuild plan")

        if submitted and f_name.strip():
            new_event = {
                "name":            f_name.strip(),
                "race_date":       f_date.isoformat(),
                "distance_km":     float(f_dist),
                "priority":        f_priority,
                "target_finish_h": float(f_target) if f_target > 0 else None,
                "notes":           f_notes.strip() or None,
            }
            upsert_race_event(conn, new_event)
            all_events = get_all_race_events(conn)
            try:
                build_plan(conn, RACE_DATE, all_events)
                st.success(f"Race '{f_name}' saved and training plan rebuilt.")
            except Exception as e:
                st.error(f"Race saved but plan rebuild failed: {e}")
            st.rerun()
        elif submitted:
            st.warning("Race name is required.")

    st.divider()
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

    tab_milestones, tab_splits = st.tabs(["Milestones", "Projected Splits"])

    with tab_milestones:
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
                st.plotly_chart(fig_elev, width="stretch")

        with band_col:
            proj_h = ms.get("projected_finish_h")
            st.markdown("**Comrades Finish Time Bands**")
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
                width="stretch",
                hide_index=True,
                column_config={
                    "day1": st.column_config.DateColumn("Day 1"),
                    "day2": st.column_config.DateColumn("Day 2"),
                    "day1_km": st.column_config.NumberColumn("Day 1 (km)", format="%.1f"),
                    "day2_km": st.column_config.NumberColumn("Day 2 (km)", format="%.1f"),
                    "combined_km": st.column_config.NumberColumn("Combined (km)", format="%.1f"),
                },
            )

    with tab_splits:
        splits_df = metrics.comrades_projected_splits(conn)
        if not splits_df.empty:
            splits_display = splits_df[["checkpoint", "km", "cumulative_time"]].copy()
            splits_display.columns = ["Checkpoint", "km", "Projected Time"]
            st.dataframe(
                splits_display,
                width="stretch",
                hide_index=True,
                column_config={
                    "km": st.column_config.NumberColumn("km", format="%.0f"),
                },
            )
            st.caption(
                "Splits derived from your latest Riegel-formula projection: "
                "**T_comrades = T_race × (90 / race_km)^1.06 × 1.04** "
                "(the 1.04 factor accounts for Comrades Down Run terrain and late-race heat). "
                "Grade adjustments shift time between sections based on elevation change — "
                "more time budgeted for climbs (Cato Ridge, Botha's Hill), less for descents into Durban. "
                "Use these as *rough targets*, not splits to chase — Comrades conditions vary widely."
            )

            elev_prof_df = pd.DataFrame(_ELEV_PROFILE, columns=["checkpoint", "km", "elevation_m"])
            fig_prof = go.Figure(go.Scatter(
                x=elev_prof_df["km"],
                y=elev_prof_df["elevation_m"],
                mode="lines+markers",
                fill="tozeroy",
                fillcolor="rgba(121,85,72,0.2)",
                line=dict(color="rgba(121,85,72,0.8)", width=2),
                text=elev_prof_df["checkpoint"],
                hovertemplate="%{text}<br>km %{x}<br>%{y}m<extra></extra>",
            ))
            fig_prof.update_layout(
                title="Comrades Down Run — Elevation Profile",
                xaxis_title="km from Pietermaritzburg",
                yaxis_title="Elevation (m)",
                height=280,
            )
            st.plotly_chart(fig_prof, width="stretch")
        else:
            st.info("No projection available yet — add a tune-up race and run sync to generate splits.")

    st.divider()
    st.subheader("Shoe Mileage")

    shoe_df = metrics.shoe_mileage(conn)
    if shoe_df.empty:
        any_gear = conn.execute("SELECT COUNT(*) FROM activities WHERE gear_id IS NOT NULL").fetchone()[0]
        if any_gear == 0:
            st.info("No shoe data yet — link your gear in Strava and run sync.")
        else:
            st.info("Gear synced but no shoe records in the gear table. Sync will populate them automatically.")
    else:
        shoe_cols = st.columns(min(len(shoe_df), 4))
        for i, (_, shoe) in enumerate(shoe_df.iterrows()):
            with shoe_cols[i % 4]:
                km       = float(shoe["total_km"])
                thresh   = float(shoe["retire_km_threshold"])
                remain   = float(shoe["km_remaining"])
                pct      = min(1.0, km / thresh) if thresh > 0 else 1.0
                flag_col = "🔴" if remain < 0 else ("🟡" if remain < 100 else "🟢")
                st.markdown(f"**{flag_col} {shoe['name']}**")
                type_label = str(shoe["type"]).capitalize() if shoe["type"] and str(shoe["type"]) != "None" else "Road"
                st.caption(type_label)
                st.progress(pct, text=f"{km:.0f} / {thresh:.0f} km")
                if remain < 0:
                    st.caption(f"⚠️ {abs(remain):.0f} km over limit")
                else:
                    st.caption(f"{remain:.0f} km remaining")
