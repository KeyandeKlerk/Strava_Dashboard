import sys
from pathlib import Path
from datetime import date

import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from db import get_conn, init_schema, upsert_race_event, get_all_race_events
from periodization import build_plan
import metrics

RACE_DATE = date(2027, 6, 13)
RACE_DISTANCE_KM = 90.0

# Comrades men's medal bands — (name, display_label, cutoff_hours).
# Gold (top 10 finishers) is position-based and omitted from time projections.
BANDS = [
    ("Wally Hayward",  "Sub 6:00",       6.0),
    ("Silver",         "6:00 – 7:29",    7.5),
    ("Bill Rowan",     "7:30 – 8:59",    9.0),
    ("Robert Mtshali", "9:00 – 9:59",   10.0),
    ("Bronze",         "10:00 – 10:59", 11.0),
    ("Vic Clapham",    "11:00 – 11:59", 12.0),
]

st.set_page_config(
    page_title="Comrades 2027 Training",
    layout="wide",
)

conn = get_conn()
init_schema(conn)

# ── Header Row ────────────────────────────────────────────────────────────────
_FILTER_MIN = date(2026, 1, 1)

days_to_race = (RACE_DATE - date.today()).days
cur = metrics.current_week_stats(conn)

_title_col, _filter_col = st.columns([3, 2])
with _title_col:
    st.title("Comrades 2027 — Training Dashboard")
    st.caption("Down Run · Pietermaritzburg → Durban · 13 June 2027")

with _filter_col:
    st.markdown("<div style='padding-top:18px'></div>", unsafe_allow_html=True)
    _range = st.date_input(
        "Filter charts by date range",
        value=(_FILTER_MIN, date.today()),
        min_value=_FILTER_MIN,
        max_value=RACE_DATE,
        format="YYYY-MM-DD",
    )

if isinstance(_range, (list, tuple)) and len(_range) == 2:
    _since, _until = _range
elif isinstance(_range, (list, tuple)) and len(_range) == 1:
    _since, _until = _range[0], date.today()
else:
    _since, _until = (_range if isinstance(_range, date) else _FILTER_MIN), date.today()

metrics.TRAINING_START = _since.isoformat()
metrics.TRAINING_END   = _until.isoformat()

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

# ── Race Calendar ─────────────────────────────────────────────────────────────
st.subheader("Race Calendar")

_race_events = get_all_race_events(conn)

if _race_events:
    _re_rows = []
    for _re in _race_events:
        _status = "upcoming"
        if _re["strava_activity_id"]:
            _status = "analysed"
        elif _re["race_date"] < date.today():
            _status = "completed"
        _re_rows.append({
            "Name":       _re["name"],
            "Date":       _re["race_date"],
            "Dist (km)":  _re["distance_km"],
            "Priority":   _re["priority"],
            "Target (h)": f"{_re['target_finish_h']:.1f}" if _re["target_finish_h"] else "—",
            "Status":     _status,
        })
    st.dataframe(
        pd.DataFrame(_re_rows),
        use_container_width=True,
        hide_index=True,
        column_config={
            "Date": st.column_config.DateColumn("Date"),
            "Dist (km)": st.column_config.NumberColumn(format="%.1f"),
        },
    )

    # Analysis panels for completed + analysed races
    _analysed = [r for r in _race_events if r["strava_activity_id"]]
    if _analysed:
        for _ar in _analysed:
            with st.expander(f"Race analysis — {_ar['name']} ({_ar['race_date']})"):
                _ra = conn.execute(
                    "SELECT avg_pace_min_km, comrades_projection_h, computed_at FROM race_analysis WHERE race_event_id = ?",
                    [_ar["id"]],
                ).fetchone()
                if _ra:
                    _ra_c1, _ra_c2, _ra_c3 = st.columns(3)
                    _ra_c1.metric("Avg Pace", f"{_ra[0]:.2f} min/km" if _ra[0] else "—")
                    _ra_c2.metric("Comrades Projection", f"{_ra[1]:.2f} h" if _ra[1] else "—")
                    _ra_c3.metric("Analysed", str(_ra[2])[:10] if _ra[2] else "—")
                else:
                    st.info("No analysis data yet — run sync after the race.")
else:
    st.info("No races scheduled yet. Add one below.")

with st.expander("Add race"):
    with st.form("add_race_form"):
        _f_name     = st.text_input("Race name", placeholder="e.g. Two Oceans Ultra")
        _f_date     = st.date_input("Race date", value=date.today())
        _f_dist     = st.number_input("Distance (km)", min_value=1.0, max_value=250.0, value=42.2, step=0.1)
        _f_priority = st.selectbox("Priority", ["A", "B"])
        _f_target   = st.number_input("Target finish (h)", min_value=0.0, max_value=24.0, value=0.0, step=0.25,
                                      help="0 = no target set")
        _f_notes    = st.text_area("Notes", placeholder="Course notes, goal, etc.")
        _submitted  = st.form_submit_button("Save & rebuild plan")

    if _submitted and _f_name.strip():
        _new_event = {
            "name":           _f_name.strip(),
            "race_date":      _f_date.isoformat(),
            "distance_km":    float(_f_dist),
            "priority":       _f_priority,
            "target_finish_h": float(_f_target) if _f_target > 0 else None,
            "notes":          _f_notes.strip() or None,
        }
        upsert_race_event(conn, _new_event)
        _all_events = get_all_race_events(conn)
        try:
            build_plan(conn, RACE_DATE, _all_events)
            st.success(f"Race '{_f_name}' saved and training plan rebuilt.")
        except Exception as _e:
            st.error(f"Race saved but plan rebuild failed: {_e}")
        st.rerun()
    elif _submitted:
        st.warning("Race name is required.")

st.divider()

# ── Mileage Trend ─────────────────────────────────────────────────────────────
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
        st.plotly_chart(fig, use_container_width=True)

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
        st.plotly_chart(fig_time, use_container_width=True)

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
                xaxis_title="Month",
                yaxis=dict(title="Distance (km)"),
                yaxis2=dict(title="Hours", overlaying="y", side="right"),
                height=360,
                legend=dict(orientation="h"),
            )
            st.plotly_chart(fig_mon, use_container_width=True)
else:
    st.info("No activity data yet. Run `python src/sync.py` first.")

st.divider()

# ── Long Run Progression ──────────────────────────────────────────────────────
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
        st.plotly_chart(fig_lr, use_container_width=True)

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
    st.caption("Mean load ÷ SD of daily loads this week. Above **2.0 = training too repetitive** — every day feels the same, which spikes overuse risk. Alternate hard and easy days to keep this below 1.5.")
with rc4:
    st.metric(
        f"{_flag(latest_long_pct, 0, 35)} Long Run %",
        f"{latest_long_pct:.1f}%" if latest_long_pct is not None else "—",
    )
    st.caption("Longest run as % of weekly volume. Above **35% risks ITB** — spread load across more sessions.")

# CTL/ATL/TSB chart (full width)
_tsb_df = metrics.ctl_atl_tsb_history(conn)
if not _tsb_df.empty:
    _tsb_df = _tsb_df.sort_values("day")
    _fig_tsb = go.Figure()
    _fig_tsb.add_trace(go.Scatter(
        x=_tsb_df["day"], y=_tsb_df["ctl"],
        name="CTL (Fitness)", mode="lines",
        line=dict(color="#2196F3", width=2),
    ))
    _fig_tsb.add_trace(go.Scatter(
        x=_tsb_df["day"], y=_tsb_df["atl"],
        name="ATL (Fatigue)", mode="lines",
        line=dict(color="#f44336", width=2),
    ))
    _fig_tsb.add_trace(go.Scatter(
        x=_tsb_df["day"], y=_tsb_df["tsb"],
        name="TSB (Form)", mode="lines",
        fill="tozeroy",
        line=dict(color="#4CAF50", width=1),
        yaxis="y2",
        fillcolor="rgba(76,175,80,0.15)",
    ))
    # Race event markers
    for _re in get_all_race_events(conn):
        _fig_tsb.add_vline(
            x=str(_re["race_date"]),
            line_dash="dash", line_color="orange", line_width=1,
            annotation_text=_re["name"][:12],
            annotation_position="top",
        )
    _fig_tsb.update_layout(
        title="CTL / ATL / TSB — Fitness, Fatigue & Form",
        height=360,
        yaxis=dict(title="Load units (CTL/ATL)"),
        yaxis2=dict(title="Form (TSB)", overlaying="y", side="right", zeroline=True),
        legend=dict(orientation="h"),
    )
    st.plotly_chart(_fig_tsb, use_container_width=True)
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

# ACWR and ramp rate side by side (retained)
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
        st.plotly_chart(fig_ramp, use_container_width=True)
        st.caption(
            "Week-on-week % change in distance. The 10% rule is a simplification — "
            "elite programs often ramp faster during base phase and cut sharply in taper. "
            "What matters: **don't spike two big weeks in a row** without a deload."
        )

st.divider()

# ── Shoe Mileage ──────────────────────────────────────────────────────────────
st.subheader("Shoe Mileage")

_shoe_df = metrics.shoe_mileage(conn)

if _shoe_df.empty:
    _any_gear = conn.execute("SELECT COUNT(*) FROM activities WHERE gear_id IS NOT NULL").fetchone()[0]
    if _any_gear == 0:
        st.info("No shoe data yet — link your gear in Strava and run sync.")
    else:
        st.info("Gear synced but no shoe records in the gear table. Sync will populate them automatically.")
else:
    _shoe_cols = st.columns(min(len(_shoe_df), 4))
    for _i, (_, _shoe) in enumerate(_shoe_df.iterrows()):
        with _shoe_cols[_i % 4]:
            _km       = float(_shoe["total_km"])
            _thresh   = float(_shoe["retire_km_threshold"])
            _remain   = float(_shoe["km_remaining"])
            _pct      = min(1.0, _km / _thresh) if _thresh > 0 else 1.0
            _flag_col = "🔴" if _remain < 0 else ("🟡" if _remain < 100 else "🟢")
            st.markdown(f"**{_flag_col} {_shoe['name']}**")
            _type_label = str(_shoe["type"]).capitalize() if _shoe["type"] and str(_shoe["type"]) != "None" else "Road"
            st.caption(_type_label)
            st.progress(_pct, text=f"{_km:.0f} / {_thresh:.0f} km")
            if _remain < 0:
                st.caption(f"⚠️ {abs(_remain):.0f} km over limit")
            else:
                st.caption(f"{_remain:.0f} km remaining")

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

zone_df = metrics.weekly_zone_time(conn)
z2_df = metrics.zone2_pace_trend(conn)
cad_df = metrics.cadence_trend(conn)

_tab_aerobic, _tab_quality = st.tabs(["Zone Analysis", "Long Run Quality"])

with _tab_aerobic:
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
            st.plotly_chart(fig_zones, use_container_width=True)

        with compliance_col:
            st.metric(
                f"{_flag(latest_easy_pct, 75, 85)} 80/20 Compliance",
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
            st.plotly_chart(fig_easy, use_container_width=True)

    col_a, col_b, col_c = st.columns(3)

    with col_a:
        if not z2_df.empty:
            fig_z2 = px.scatter(
                z2_df,
                x="activity_date", y="pace_min_per_km",
                trendline="ols",
                title="Zone 2 Pace (min/km)",
                labels={"pace_min_per_km": "Pace (min/km)", "activity_date": "Date"},
                hover_data=["name", "distance_km", "average_heartrate"],
            )
            fig_z2.update_layout(height=300)
            st.plotly_chart(fig_z2, use_container_width=True)
            st.caption(
                "Pace (min/km) during Zone 2 efforts. A **downward trend** = getting faster at the same heart rate = "
                "aerobic fitness improving. This is the primary long-term signal for Comrades readiness."
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
            st.plotly_chart(fig_decoup, use_container_width=True)
            st.caption(
                "**Aerobic decoupling** = how much your heart rate drifts relative to pace in the second half of a run. "
                "Low (<5%) = cardiovascular system is efficient and holding pace without extra effort. "
                "High (>5%) = fatigue or heat is forcing your heart to work harder to maintain the same speed — "
                "your aerobic base needs more work."
            )

    with col_c:
        if not cad_df.empty:
            fig_cad = px.scatter(
                cad_df,
                x="activity_date", y="cadence_avg",
                trendline="ols",
                title="Cadence Trend (spm)",
                labels={"cadence_avg": "Cadence (spm)", "activity_date": "Date"},
                hover_data=["name", "distance_km"],
            )
            fig_cad.add_hline(y=170, line_dash="dash", line_color="orange", line_width=1,
                              annotation_text="170 min target")
            fig_cad.add_hline(y=180, line_dash="dash", line_color="green", line_width=1,
                              annotation_text="180 optimal")
            fig_cad.update_layout(height=300)
            st.plotly_chart(fig_cad, use_container_width=True)
            st.caption(
                "Steps per minute. Higher cadence = shorter ground contact time = less braking force = lower injury risk. "
                "170–180 spm is the evidence-based range. On Comrades' long descents, "
                "cadence control is critical to protect your quads."
            )
        else:
            st.info("No cadence data yet. Run `python src/backfill.py`.")

with _tab_quality:
    _lrq_df = metrics.long_run_quality_scores(conn)
    if not _lrq_df.empty:
        _fig_lrq = px.scatter(
            _lrq_df,
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
        _fig_lrq.update_layout(height=380)
        st.plotly_chart(_fig_lrq, use_container_width=True)
        st.caption(
            "**Quality Score (0–100):** composite of two signals — "
            "**Z2 compliance** (50% weight): % of run time in Z1+Z2 heart rate; maps 60–100% → 0–100 pts. "
            "**Aerobic decoupling** (50% weight): HR drift inverted; maps 0–5% drift → 100–0 pts. "
            "A score above 70 means you ran long, stayed aerobic, and your cardiovascular system held up. "
            "Larger dot = longer run. The trendline shows whether long run quality is improving over time."
        )
    else:
        st.info("No long runs ≥20 km with stream data yet. Run `python src/backfill.py` to populate.")

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

_tab_milestones, _tab_splits = st.tabs(["Milestones", "Projected Splits"])

with _tab_milestones:
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

with _tab_splits:
    _splits_df = metrics.comrades_projected_splits(conn)
    if not _splits_df.empty:
        _splits_display = _splits_df[["checkpoint", "km", "cumulative_time"]].copy()
        _splits_display.columns = ["Checkpoint", "km", "Projected Time"]
        st.dataframe(
            _splits_display,
            use_container_width=True,
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

        # Reference elevation profile
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
        _elev_prof_df = pd.DataFrame(_ELEV_PROFILE, columns=["checkpoint", "km", "elevation_m"])
        _fig_prof = go.Figure(go.Scatter(
            x=_elev_prof_df["km"],
            y=_elev_prof_df["elevation_m"],
            mode="lines+markers",
            fill="tozeroy",
            fillcolor="rgba(121,85,72,0.2)",
            line=dict(color="rgba(121,85,72,0.8)", width=2),
            text=_elev_prof_df["checkpoint"],
            hovertemplate="%{text}<br>km %{x}<br>%{y}m<extra></extra>",
        ))
        _fig_prof.update_layout(
            title="Comrades Down Run — Elevation Profile",
            xaxis_title="km from Pietermaritzburg",
            yaxis_title="Elevation (m)",
            height=280,
        )
        st.plotly_chart(_fig_prof, use_container_width=True)
    else:
        st.info("No projection available yet — add a tune-up race and run sync to generate splits.")

st.divider()

# ── Long Run Log ──────────────────────────────────────────────────────────────
st.subheader("Long Run Log (≥20 km)")

lr_hist_df = metrics.long_run_history(conn, min_km=20.0)
if not lr_hist_df.empty:
    st.dataframe(
        lr_hist_df,
        use_container_width=True,
        hide_index=True,
        column_config={
            "activity_date": st.column_config.DateColumn("Date"),
            "name": "Name",
            "distance_km": st.column_config.NumberColumn("Dist (km)", format="%.1f"),
            "duration_min": st.column_config.NumberColumn("Time (min)", format="%.0f"),
            "elevation_gain_m": st.column_config.NumberColumn("Gain (m)", format="%.0f"),
            "avg_hr": st.column_config.NumberColumn("Avg HR", format="%.0f"),
            "pace_min_km": st.column_config.NumberColumn("Pace (min/km)", format="%.2f"),
            "decoupling_pct": st.column_config.NumberColumn("Decoupling %", format="%.1f"),
            "pct_time_z2": st.column_config.NumberColumn("Z2 %", format="%.0f"),
        },
    )
else:
    st.info("No runs ≥20 km yet.")

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

# ── Training Plan ─────────────────────────────────────────────────────────────
st.subheader("Training Plan")

_ICON = {
    "rest":        "⬜",
    "sc":          "💪",
    "easy_run":    "🟢",
    "quality_run": "🟡",
    "long_run":    "🔵",
    "hills":       "🟠",
    "cricket":     "🏏",
    "race":        "🏆",
}
_INTENSITY_LABEL = {
    "easy": "Easy", "moderate": "Moderate", "hard": "Hard", "race": "RACE", "rest": "—",
}

week_summary = metrics.weekly_completion_summary(conn)

if week_summary.empty:
    st.info(
        "No plan loaded yet. Add a race via the Race Calendar section above, "
        "or run `build_plan(conn, RACE_DATE, [])` from a Python console."
    )
else:
    # ── Week selector ─────────────────────────────────────────────────────────
    today = date.today()

    def _week_label(row):
        start = row["week_start_date"]
        # pandas Timestamp → date
        if hasattr(start, "date"):
            start = start.date()
        end = start + __import__("datetime").timedelta(days=6)
        deload_tag = " [DELOAD]" if row["is_deload"] else ""
        done = int(row["days_done"])
        total = int(row["total_days"])
        return (f"Wk {int(row['week_number']):02d}  {start.strftime('%b %d')}–{end.strftime('%d')}"
                f"  ·  {row['phase']}{deload_tag}  ·  {done}/{total} done")

    labels      = [_week_label(r) for _, r in week_summary.iterrows()]
    week_nums   = week_summary["week_number"].tolist()

    # Default to the week containing today
    starts = week_summary["week_start_date"].tolist()
    default_idx = 0
    for i, s in enumerate(starts):
        s_date = s.date() if hasattr(s, "date") else s
        if s_date <= today < s_date + __import__("datetime").timedelta(days=7):
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

    # ── Weekly overview strip ─────────────────────────────────────────────────
    with st.expander("All weeks — overview", expanded=False):
        disp = week_summary[
            ["week_number", "week_start_date", "phase", "planned_distance_km",
             "run_days_done", "run_days", "completion_pct", "is_deload"]
        ].copy()
        disp.columns = ["Week", "Mon", "Phase", "Plan km",
                        "Runs done", "Run days", "Done %", "Deload"]
        st.dataframe(
            disp,
            use_container_width=True,
            hide_index=True,
            column_config={
                "Mon":     st.column_config.DateColumn("Week start"),
                "Plan km": st.column_config.NumberColumn(format="%.0f"),
                "Done %":  st.column_config.ProgressColumn(min_value=0, max_value=100),
                "Deload":  st.column_config.CheckboxColumn(),
            },
        )

    # ── Daily drill-down ──────────────────────────────────────────────────────
    daily = metrics.daily_plan_for_week(conn, selected_week_num)

    if daily.empty:
        st.info("No daily sessions yet — run `build_plan` from the Race Calendar section above.")
    else:
        # Header row
        h0, h1, h2, h3, h4, h5 = st.columns([1, 2, 3, 2, 2, 8])
        h0.markdown("**·**")
        h1.markdown("**Day**")
        h2.markdown("**Session**")
        h3.markdown("**Planned**")
        h4.markdown("**Actual**")
        h5.markdown("**Notes**")
        st.markdown("<hr style='margin:4px 0'>", unsafe_allow_html=True)

        for _, r in daily.iterrows():
            icon    = _ICON.get(str(r["session_type"]), "⬜")
            _pdate  = r["planned_date"]
            _pdate  = _pdate.date() if hasattr(_pdate, "date") else _pdate
            status  = "✅" if r["completed"] else ("⏳" if _pdate >= today else "❌")
            plan_d  = f"{r['planned_km']:.0f} km" if r["planned_km"] and r["planned_km"] > 0 else "—"
            actual_d = f"{r['actual_km']:.1f} km" if r["actual_km"] else "—"
            session_label = f"{icon} {str(r['session_type']).replace('_', ' ').title()}"
            effort  = _INTENSITY_LABEL.get(str(r["intensity"]), str(r["intensity"]))
            day_str = f"**{str(r['day_of_week'])[:3]}**  \n{_pdate.strftime('%b %d')}"

            c0, c1, c2, c3, c4, c5 = st.columns([1, 2, 3, 2, 2, 8])
            c0.write(status)
            c1.markdown(day_str)
            c2.markdown(f"{session_label}  \n<small>{effort}</small>", unsafe_allow_html=True)
            c3.write(plan_d)
            c4.write(actual_d)
            c5.markdown(str(r["description"]))
