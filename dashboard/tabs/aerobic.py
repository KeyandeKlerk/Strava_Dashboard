# dashboard/tabs/aerobic.py
import plotly.express as px
import streamlit as st

import metrics
from shared import flag, fmt_pace


def render(conn) -> None:
    st.subheader("Aerobic Fitness")

    zone_df = metrics.weekly_zone_time(conn)
    z2_df = metrics.run_pace_trend(conn)
    lrq_df = metrics.long_run_quality_scores(conn)

    tab_aerobic, tab_quality = st.tabs(["Zone Analysis", "Long Run Quality"])

    with tab_aerobic:
        if not zone_df.empty:
            zone_sorted = zone_df.sort_values("week_start").copy()
            zone_cols = ["z1_min", "z2_min", "z3_min", "z4_min", "z5_min"]
            zone_sorted["total_min"] = zone_sorted[zone_cols].sum(axis=1)
            zone_sorted["easy_pct"] = (
                (zone_sorted["z1_min"] + zone_sorted["z2_min"])
                / zone_sorted["total_min"].replace(0, float("nan")) * 100
            )
            latest_easy_pct = float(zone_sorted["easy_pct"].dropna().iloc[-1]) if zone_sorted["easy_pct"].notna().any() else None

            z_col, compliance_col = st.columns([3, 1])

            with z_col:
                zone_melt = zone_sorted.melt(
                    id_vars="week_start",
                    value_vars=zone_cols,
                    var_name="zone",
                    value_name="minutes",
                )
                zone_melt["zone"] = zone_melt["zone"].str.replace("_min", "").str.upper()
                fig_zones = px.bar(
                    zone_melt, x="week_start", y="minutes", color="zone",
                    title="Weekly Running Time in HR Zones",
                    labels={"minutes": "Minutes", "week_start": "Week", "zone": "Zone"},
                    color_discrete_map={
                        "Z1": "#4fc3f7",
                        "Z2": "#66bb6a",
                        "Z3": "#ffa726",
                        "Z4": "#ef5350",
                        "Z5": "#ab47bc",
                    },
                )
                fig_zones.update_layout(height=320, legend=dict(orientation="h"))
                st.plotly_chart(fig_zones, width="stretch")

            with compliance_col:
                st.metric(
                    f"{flag(latest_easy_pct, 75, 85)} 80/20 Compliance",
                    f"{latest_easy_pct:.0f}%" if latest_easy_pct is not None else "—",
                )
                st.caption("% of run time in Z1+Z2. Target **75–85%** for polarized ultra training.")
                fig_easy = px.line(
                    zone_sorted.dropna(subset=["easy_pct"]),
                    x="week_start", y="easy_pct",
                    labels={"easy_pct": "Easy %", "week_start": "Week"},
                )
                fig_easy.add_hline(y=80, line_dash="dash", line_color="green", line_width=1,
                                   annotation_text="80% target")
                fig_easy.update_layout(height=220, margin=dict(t=10, b=10))
                st.plotly_chart(fig_easy, width="stretch")

        col_a, col_b = st.columns(2)

        with col_a:
            if not z2_df.empty:
                z2 = z2_df.copy()
                z2["pace_fmt"] = z2["pace_min_per_km"].apply(fmt_pace)
                fig_z2 = px.scatter(
                    z2,
                    x="activity_date", y="pace_min_per_km",
                    trendline="ols",
                    title="Run Pace Trend (min/km)",
                    labels={"pace_min_per_km": "Pace (min/km)", "activity_date": "Date"},
                    hover_data={"pace_min_per_km": False, "pace_fmt": True,
                                "name": True, "distance_km": True, "average_heartrate": True},
                )
                pace_vals = z2["pace_min_per_km"].dropna()
                if not pace_vals.empty:
                    tick_start = int(pace_vals.min() * 2) / 2
                    tick_end   = int(pace_vals.max() * 2 + 1) / 2
                    tickvals   = [tick_start + i * 0.5
                                  for i in range(int((tick_end - tick_start) / 0.5) + 1)]
                    fig_z2.update_yaxes(tickvals=tickvals,
                                        ticktext=[fmt_pace(v) for v in tickvals])
                fig_z2.update_layout(height=300)
                st.plotly_chart(fig_z2, width="stretch")
                st.caption(
                    "Pace trend across all runs ≥5 km. A **downward trend** = getting faster over time. "
                    "Colour by Zone 2 % to spot aerobic efficiency gains."
                )
            else:
                st.info("No streams data yet. Run `python src/backfill.py`.")

        with col_b:
            if not z2_df.empty:
                fig_decoup = px.bar(
                    z2_df.tail(20),
                    x="activity_date", y="decoupling_pct",
                    title="Aerobic Decoupling % (last 20)",
                    labels={"decoupling_pct": "Decoupling %", "activity_date": "Date"},
                    color="decoupling_pct",
                    color_continuous_scale=["green", "yellow", "red"],
                    range_color=[-5, 5],
                )
                fig_decoup.add_hline(y=5, line_dash="dash", line_color="red",
                                     annotation_text=">5% = poor efficiency")
                fig_decoup.update_layout(height=300, showlegend=False)
                st.plotly_chart(fig_decoup, width="stretch")
                st.caption(
                    "**Aerobic decoupling** = how much your heart rate drifts relative to pace in the second half of a run. "
                    "Low (<5%) = cardiovascular system is efficient and holding pace without extra effort. "
                    "High (>5%) = fatigue or heat is forcing your heart to work harder to maintain the same speed — "
                    "your aerobic base needs more work."
                )

    with tab_quality:
        if not lrq_df.empty:
            fig_lrq = px.scatter(
                lrq_df,
                x="activity_date",
                y="quality_score",
                size="distance_km",
                color="quality_score",
                color_continuous_scale=["red", "orange", "green"],
                range_color=[0, 100],
                trendline="ols",
                hover_data=["name", "distance_km", "z2_compliance_pct", "decoupling_pct"],
                title="Long Run Quality Score (≥20 km runs)",
                labels={
                    "quality_score": "Quality Score",
                    "activity_date": "Date",
                    "distance_km": "Distance (km)",
                },
            )
            fig_lrq.update_layout(height=380)
            st.plotly_chart(fig_lrq, width="stretch")
            st.caption(
                "**Quality Score (0–100):** composite of two signals — "
                "**Z2 compliance** (50% weight): % of run time in Z1+Z2 heart rate; maps 60–100% → 0–100 pts. "
                "**Aerobic decoupling** (50% weight): HR drift inverted; maps 0–5% drift → 100–0 pts. "
                "A score above 70 means you ran long, stayed aerobic, and your cardiovascular system held up. "
                "Larger dot = longer run. The trendline shows whether long run quality is improving over time."
            )
        else:
            st.info("No long runs ≥20 km with stream data yet. Run `python src/backfill.py` to populate.")
