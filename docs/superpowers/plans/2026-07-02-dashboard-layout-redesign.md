# Dashboard Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1099-line single-scroll `dashboard/app.py` into a thin shell + 5 tab modules (Today / Training Load / Aerobic Performance / Race Prep / Plan & History), and remove the cadence chart and its backend code since the user's watch doesn't track cadence.

**Architecture:** Extract shared constants/helpers into `dashboard/shared.py`. Build one `dashboard/tabs/<name>.py` module per tab, each exposing a single `render(conn)` function that fetches its own data via `src/metrics.py` calls (no shared fetch-once cache — duckdb queries are cheap here). Rewrite `dashboard/app.py` last, as a thin shell: page config, DB connection, the persistent header (title/filter/top metrics/highlights), and `st.tabs(...)` dispatching into the 5 modules. Delete `metrics.cadence_trend()` only after `app.py` no longer references it, so the app never sits in a broken state between commits.

**Tech Stack:** Python, Streamlit, DuckDB, pandas, Plotly (existing stack, no new dependencies).

## Global Constraints

- Preserve all existing chart content, labels, captions, thresholds, and formatting exactly except where the spec calls for a change (cadence removal, tab regrouping). This is a structural refactor, not a redesign of individual charts.
- Use `st.plotly_chart(fig, width="stretch")` (not the deprecated `use_container_width=True`) — matches the rest of the already-migrated codebase.
- No comments in code unless documenting a non-obvious constraint.
- No new pip dependencies.
- Follow the source spec at `docs/superpowers/specs/2026-07-02-dashboard-layout-redesign-design.md`.

---

## Task 1: Extract shared constants and helpers into `dashboard/shared.py`

**Files:**
- Create: `dashboard/shared.py`
- Test: `tests/test_dashboard_shared.py`

**Interfaces:**
- Consumes: nothing (pure functions/constants, no dependency on `src/` modules)
- Produces (used by later tasks):
  - `shared.RACE_DATE: date` = `date(2027, 6, 13)`
  - `shared.RACE_DISTANCE_KM: float` = `90.0`
  - `shared.BANDS: list[tuple[str, str, float]]` — medal bands
  - `shared.ICON: dict[str, str]` — session type → emoji
  - `shared.INTENSITY_LABEL: dict[str, str]` — intensity → display label
  - `shared.fmt_pace(min_per_km: float | None) -> str`
  - `shared.flag(value: float | None, low: float, high: float) -> str`
  - `shared.week_label(row: pd.Series) -> str`
  - `shared.render_daily_sessions(daily: pd.DataFrame, today: date) -> None`

- [ ] **Step 1: Write the failing tests for the pure helpers**

Create `tests/test_dashboard_shared.py`:

```python
# tests/test_dashboard_shared.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "dashboard"))

from shared import fmt_pace, flag


def test_fmt_pace_formats_minutes_and_seconds():
    assert fmt_pace(5.5) == "5:30"


def test_fmt_pace_handles_none():
    assert fmt_pace(None) == "—"


def test_fmt_pace_handles_nan():
    assert fmt_pace(float("nan")) == "—"


def test_flag_green_in_range():
    assert flag(1.0, 0.8, 1.3) == "🟢"


def test_flag_red_far_outside_range():
    assert flag(2.0, 0.8, 1.3) == "🔴"


def test_flag_yellow_near_edge():
    assert flag(1.35, 0.8, 1.3) == "🟡"


def test_flag_white_circle_for_missing_value():
    assert flag(None, 0.8, 1.3) == "⚪"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_dashboard_shared.py -v`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'shared'` (file doesn't exist yet).

- [ ] **Step 3: Create `dashboard/shared.py`**

```python
# dashboard/shared.py
from datetime import date, timedelta

import pandas as pd
import streamlit as st

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

ICON = {
    "rest":        "⬜",
    "sc":          "💪",
    "easy_run":    "🟢",
    "quality_run": "🟡",
    "long_run":    "🔵",
    "hills":       "🟠",
    "cricket":     "🏏",
    "race":        "🏆",
}
INTENSITY_LABEL = {
    "easy": "Easy", "moderate": "Moderate", "hard": "Hard", "race": "RACE", "rest": "—",
}


def fmt_pace(min_per_km) -> str:
    if not min_per_km or min_per_km != min_per_km:
        return "—"
    total_sec = round(float(min_per_km) * 60)
    m, s = divmod(total_sec, 60)
    return f"{m}:{s:02d}"


def flag(value, low, high):
    if value is None or pd.isna(value):
        return "⚪"
    if low <= value <= high:
        return "🟢"
    if value < low * 0.9 or value > high * 1.15:
        return "🔴"
    return "🟡"


def week_label(row) -> str:
    start = row["week_start_date"]
    if hasattr(start, "date"):
        start = start.date()
    end = start + timedelta(days=6)
    deload_tag = " [DELOAD]" if row["is_deload"] else ""
    done = int(row["days_done"])
    total = int(row["total_days"])
    return (f"Wk {int(row['week_number']):02d}  {start.strftime('%b %d')}–{end.strftime('%d')}"
            f"  ·  {row['phase']}{deload_tag}  ·  {done}/{total} done")


def render_daily_sessions(daily: pd.DataFrame, today: date) -> None:
    h0, h1, h2, h3, h4, h5 = st.columns([1, 2, 3, 2, 2, 8])
    h0.markdown("**·**")
    h1.markdown("**Day**")
    h2.markdown("**Session**")
    h3.markdown("**Planned**")
    h4.markdown("**Actual**")
    h5.markdown("**Notes**")
    st.markdown("<hr style='margin:4px 0'>", unsafe_allow_html=True)

    prev_date = None
    for _, r in daily.iterrows():
        icon          = ICON.get(str(r["session_type"]), "⬜")
        pdate         = r["planned_date"]
        pdate         = pdate.date() if hasattr(pdate, "date") else pdate
        status        = "✅" if r["completed"] else ("⏳" if pdate >= today else "❌")
        plan_d        = f"{r['planned_km']:.0f} km" if r["planned_km"] and r["planned_km"] > 0 else "—"
        actual_d      = f"{r['actual_km']:.1f} km" if r["actual_km"] else "—"
        session_label = f"{icon} {str(r['session_type']).replace('_', ' ').title()}"
        effort        = INTENSITY_LABEL.get(str(r["intensity"]), str(r["intensity"]))

        is_new_day = pdate != prev_date
        if is_new_day and prev_date is not None:
            st.markdown("<hr style='margin:2px 0; opacity:0.3'>", unsafe_allow_html=True)
        day_str = f"**{str(r['day_of_week'])[:3]}**  \n{pdate.strftime('%b %d')}" if is_new_day else ""
        prev_date = pdate

        c0, c1, c2, c3, c4, c5 = st.columns([1, 2, 3, 2, 2, 8])
        c0.write(status)
        c1.markdown(day_str)
        c2.markdown(f"{session_label}  \n<small>{effort}</small>", unsafe_allow_html=True)
        c3.write(plan_d)
        c4.write(actual_d)
        c5.markdown(str(r["description"]))
```

Note: `week_label` and `render_daily_sessions` are Streamlit-rendering helpers with no automated test — this repo has no precedent for testing Streamlit UI code (confirmed: no existing tests reference `st.` calls). They're verified via the smoke-test commands in later tasks and the final manual run-through.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_dashboard_shared.py -v`
Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add dashboard/shared.py tests/test_dashboard_shared.py
git commit -m "$(cat <<'EOF'
refactor: extract shared dashboard constants and helpers

Pulls RACE_DATE, medal bands, and pure formatting/flagging helpers
out of app.py into dashboard/shared.py so upcoming per-tab modules
can share them without duplication.
EOF
)"
```

---

## Task 2: Build the Today tab module (`dashboard/tabs/today.py`)

**Files:**
- Create: `dashboard/tabs/__init__.py` (empty)
- Create: `dashboard/tabs/today.py`

**Interfaces:**
- Consumes:
  - `shared.flag(value, low, high) -> str`, `shared.render_daily_sessions(daily, today) -> None` (Task 1)
  - `metrics.acwr_history(conn) -> pd.DataFrame` (column `acwr`)
  - `metrics.weekly_ramp_rate(conn) -> pd.DataFrame` (column `ramp_pct`)
  - `metrics.weekly_monotony(conn) -> pd.DataFrame` (column `monotony`)
  - `metrics.long_run_pct(conn) -> pd.DataFrame` (column `long_run_pct`)
  - `metrics.weekly_completion_summary(conn) -> pd.DataFrame` (columns `week_start_date`, `week_number`, `run_days_done`, `run_days`, `completion_pct`)
  - `metrics.daily_plan_for_week(conn, week_number) -> pd.DataFrame`
- Produces (used by Task 7): `tabs.today.render(conn: duckdb.DuckDBPyConnection) -> None`

- [ ] **Step 1: Create the empty tabs package**

```bash
mkdir -p dashboard/tabs
touch dashboard/tabs/__init__.py
```

- [ ] **Step 2: Write `dashboard/tabs/today.py`**

```python
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
```

- [ ] **Step 3: Smoke-test the module in isolation**

Run:
```bash
python -c "
import sys
sys.path.insert(0, 'src')
sys.path.insert(0, 'dashboard')
from db import get_conn, init_schema
from tabs import today
conn = get_conn()
init_schema(conn)
today.render(conn)
print('SMOKE_OK')
"
```
Expected: output ends with `SMOKE_OK` on its own line, exit code 0, no `Traceback` in output (Streamlit "missing ScriptRunContext" warnings are expected and harmless in this bare-mode invocation).

- [ ] **Step 4: Commit**

```bash
git add dashboard/tabs/__init__.py dashboard/tabs/today.py
git commit -m "$(cat <<'EOF'
feat: add Today tab module with risk flags and current week's plan

First of five tab render modules for the dashboard layout redesign.
Not yet wired into app.py (Task 7).
EOF
)"
```

---

## Task 3: Build the Training Load tab module (`dashboard/tabs/training_load.py`)

**Files:**
- Create: `dashboard/tabs/training_load.py`

**Interfaces:**
- Consumes:
  - `shared.RACE_DISTANCE_KM: float` (Task 1)
  - `metrics.weekly_volume(conn) -> pd.DataFrame` (columns `week_start`, `run_distance_km`, `run_time_min`, `longest_run_km`)
  - `metrics.plan_adherence(conn) -> pd.DataFrame` (columns `week_start_date`, `planned_distance_km`)
  - `metrics.monthly_volume(conn) -> pd.DataFrame` (columns `month_start`, `run_distance_km`, `run_time_h`)
  - `metrics.ctl_atl_tsb_history(conn, since=None, until=None) -> pd.DataFrame` (columns `day`, `ctl`, `atl`, `tsb`)
  - `metrics.acwr_history(conn) -> pd.DataFrame` (columns `day`, `acwr`)
  - `metrics.weekly_ramp_rate(conn) -> pd.DataFrame` (columns `week_start`, `ramp_pct`)
  - `metrics.weekly_category_load(conn) -> pd.DataFrame` (columns `week_start`, `running_load`, `volleyball_load`, `cricket_load`, `gym_load`)
  - `metrics.TRAINING_START: str`, `metrics.TRAINING_END: str | None` (module globals set by `app.py`'s header, Task 7)
  - `db.get_all_race_events(conn) -> list[dict]` (each with `race_date`, `name`)
- Produces (used by Task 7): `tabs.training_load.render(conn) -> None`

- [ ] **Step 1: Write `dashboard/tabs/training_load.py`**

```python
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
```

- [ ] **Step 2: Smoke-test the module in isolation**

Run:
```bash
python -c "
import sys
sys.path.insert(0, 'src')
sys.path.insert(0, 'dashboard')
from db import get_conn, init_schema
import metrics
metrics.TRAINING_START = '2026-01-01'
metrics.TRAINING_END = None
from tabs import training_load
conn = get_conn()
init_schema(conn)
training_load.render(conn)
print('SMOKE_OK')
"
```
Expected: output ends with `SMOKE_OK`, exit code 0, no `Traceback`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/tabs/training_load.py
git commit -m "$(cat <<'EOF'
feat: add Training Load tab module

Weekly mileage, long run progression, CTL/ATL/TSB, ACWR, ramp rate,
and category load — the "how much and how hard" view.
EOF
)"
```

---

## Task 4: Build the Aerobic Performance tab module (`dashboard/tabs/aerobic.py`), cadence-free

**Files:**
- Create: `dashboard/tabs/aerobic.py`

**Interfaces:**
- Consumes:
  - `shared.flag(value, low, high) -> str`, `shared.fmt_pace(min_per_km) -> str` (Task 1)
  - `metrics.weekly_zone_time(conn) -> pd.DataFrame` (columns `week_start`, `z1_min`..`z5_min`)
  - `metrics.run_pace_trend(conn) -> pd.DataFrame` (columns `activity_date`, `pace_min_per_km`, `decoupling_pct`, `name`, `distance_km`, `average_heartrate`)
  - `metrics.long_run_quality_scores(conn) -> pd.DataFrame` (columns `activity_date`, `quality_score`, `distance_km`, `name`, `z2_compliance_pct`, `decoupling_pct`)
- Produces (used by Task 7): `tabs.aerobic.render(conn) -> None`
- **No `metrics.cadence_trend` reference** — this module is written cadence-free from the start (deleted from `metrics.py` in Task 8).

- [ ] **Step 1: Write `dashboard/tabs/aerobic.py`**

```python
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
```

- [ ] **Step 2: Smoke-test the module in isolation**

Run:
```bash
python -c "
import sys
sys.path.insert(0, 'src')
sys.path.insert(0, 'dashboard')
from db import get_conn, init_schema
from tabs import aerobic
conn = get_conn()
init_schema(conn)
aerobic.render(conn)
print('SMOKE_OK')
"
```
Expected: output ends with `SMOKE_OK`, exit code 0, no `Traceback`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/tabs/aerobic.py
git commit -m "$(cat <<'EOF'
feat: add Aerobic Performance tab module (cadence-free)

Zone analysis, pace trend, decoupling, and long run quality score.
Cadence chart intentionally omitted — the watch doesn't track cadence.
EOF
)"
```

---

## Task 5: Build the Race Prep tab module (`dashboard/tabs/race_prep.py`)

**Files:**
- Create: `dashboard/tabs/race_prep.py`

**Interfaces:**
- Consumes:
  - `shared.BANDS`, `shared.RACE_DATE`, `shared.RACE_DISTANCE_KM`, `shared.fmt_pace` (Task 1)
  - `db.get_all_race_events(conn) -> list[dict]` (keys: `id`, `name`, `race_date`, `distance_km`, `priority`, `target_finish_h`, `strava_activity_id`)
  - `db.upsert_race_event(conn, event: dict) -> None`
  - `periodization.build_plan(conn, race_date: date, race_events: list[dict]) -> None`
  - `metrics.comrades_milestones(conn, race_distance_km) -> dict` (keys: `longest_run_km`, `longest_run_pct_race`, `total_gain_m`, `total_descent_m`, `descent_pct_practiced`, `race_descent_m`, `runs_20plus`, `runs_30plus`, `max_b2b_km`, `projected_finish_h`, `cutoff_h`)
  - `metrics.back_to_back_runs(conn) -> pd.DataFrame` (columns `day1`, `day2`, `day1_km`, `day2_km`, `combined_km`)
  - `metrics.weekly_elevation(conn) -> pd.DataFrame` (columns `week_start`, `weekly_gain_m`)
  - `metrics.comrades_projected_splits(conn) -> pd.DataFrame` (columns `checkpoint`, `km`, `cumulative_time`)
  - `metrics.shoe_mileage(conn) -> pd.DataFrame` (columns `name`, `type`, `total_km`, `retire_km_threshold`, `km_remaining`)
- Produces (used by Task 7): `tabs.race_prep.render(conn) -> None`

- [ ] **Step 1: Write `dashboard/tabs/race_prep.py`**

```python
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
```

- [ ] **Step 2: Smoke-test the module in isolation**

Run:
```bash
python -c "
import sys
sys.path.insert(0, 'src')
sys.path.insert(0, 'dashboard')
from db import get_conn, init_schema
from tabs import race_prep
conn = get_conn()
init_schema(conn)
race_prep.render(conn)
print('SMOKE_OK')
"
```
Expected: output ends with `SMOKE_OK`, exit code 0, no `Traceback`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/tabs/race_prep.py
git commit -m "$(cat <<'EOF'
feat: add Race Prep tab module

Race calendar + add-race form, Comrades milestones, medal bands,
projected splits with elevation profile, and shoe mileage.
EOF
)"
```

---

## Task 6: Build the Plan & History tab module (`dashboard/tabs/plan_history.py`)

**Files:**
- Create: `dashboard/tabs/plan_history.py`

**Interfaces:**
- Consumes:
  - `shared.fmt_pace`, `shared.render_daily_sessions`, `shared.week_label` (Task 1)
  - `metrics.long_run_history(conn, min_km=20.0) -> pd.DataFrame`
  - `metrics.recent_activities(conn, n=15) -> pd.DataFrame`
  - `metrics.weekly_completion_summary(conn) -> pd.DataFrame`
  - `metrics.daily_plan_for_week(conn, week_number) -> pd.DataFrame`
  - `db.upsert_daily_session(conn, row: dict) -> None`
  - `db.sync_weekly_from_daily(conn) -> None`
  - `db.correlate_activities_to_plan(conn) -> None`
- Produces (used by Task 7): `tabs.plan_history.render(conn) -> None`

- [ ] **Step 1: Write `dashboard/tabs/plan_history.py`**

```python
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
```

- [ ] **Step 2: Smoke-test the module in isolation**

Run:
```bash
python -c "
import sys
sys.path.insert(0, 'src')
sys.path.insert(0, 'dashboard')
from db import get_conn, init_schema
from tabs import plan_history
conn = get_conn()
init_schema(conn)
plan_history.render(conn)
print('SMOKE_OK')
"
```
Expected: output ends with `SMOKE_OK`, exit code 0, no `Traceback`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/tabs/plan_history.py
git commit -m "$(cat <<'EOF'
feat: add Plan & History tab module

CSV import, all-weeks overview with drill-down, week selector,
long run log, and recent activities — reference material moved
out of the daily-glance view.
EOF
)"
```

---

## Task 7: Rewrite `dashboard/app.py` as the thin shell wiring all 5 tabs

**Files:**
- Modify: `dashboard/app.py` (full rewrite)

**Interfaces:**
- Consumes: `tabs.today.render`, `tabs.training_load.render`, `tabs.aerobic.render`, `tabs.race_prep.render`, `tabs.plan_history.render` (Tasks 2–6); `shared.RACE_DATE`, `shared.RACE_DISTANCE_KM` (Task 1); `db.get_conn`, `db.init_schema`; `metrics.current_week_stats`, `metrics.ctl_atl_tsb_history`, `metrics.weekly_ramp_rate`, `metrics.comrades_milestones`, `metrics.long_run_quality_scores`, `metrics.shoe_mileage`, `metrics.weekly_completion_summary`; `highlights.build_highlights`
- Produces: the running dashboard (no downstream code consumes `app.py`)

- [ ] **Step 1: Replace the full contents of `dashboard/app.py`**

```python
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
from tabs import today, training_load, aerobic, race_prep, plan_history

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
tab_today, tab_load, tab_aerobic, tab_race, tab_plan = st.tabs(
    ["Today", "Training Load", "Aerobic Performance", "Race Prep", "Plan & History"]
)

with tab_today:
    today.render(conn)

with tab_load:
    training_load.render(conn)

with tab_aerobic:
    aerobic.render(conn)

with tab_race:
    race_prep.render(conn)

with tab_plan:
    plan_history.render(conn)
```

- [ ] **Step 2: Run the full-app smoke test**

Run:
```bash
timeout 20 python dashboard/app.py > /tmp/app_smoke.log 2>&1
echo "EXIT:$?"
grep -iE "error|traceback|exception" /tmp/app_smoke.log || echo "NO_ERRORS_FOUND"
```
Expected: `EXIT:0` and `NO_ERRORS_FOUND` (the "missing ScriptRunContext" warning lines are expected and harmless — they only appear because this runs the script outside `streamlit run`).

- [ ] **Step 3: Run the full automated test suite**

Run: `pytest -v`
Expected: all tests pass (same pass count as before this task, since no `src/` behavior changed — `metrics.cadence_trend` is still present and unused at this point, removed in Task 8).

- [ ] **Step 4: Manually verify in the browser**

Run: `streamlit run dashboard/app.py` and open the printed local URL. Confirm:
- All 5 tabs render (Today, Training Load, Aerobic Performance, Race Prep, Plan & History)
- Today tab shows the 4 risk-flag metrics and the current week's sessions
- No cadence chart appears anywhere
- Every chart/table that existed in the old single-page layout is present in its new tab
Stop the server (Ctrl+C) once confirmed.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app.py
git commit -m "$(cat <<'EOF'
refactor: rewrite dashboard/app.py as a thin shell over tab modules

app.py now only handles page config, the persistent header (title,
date filter, top metrics, highlights), and dispatch into the 5 tab
render modules. Replaces the single 1099-line scrolling page.
EOF
)"
```

---

## Task 8: Delete dead cadence code from `src/metrics.py` and its test

**Files:**
- Modify: `src/metrics.py:216-229` (delete `cadence_trend` function)
- Modify: `tests/test_metrics.py:255-259` (delete `test_cadence_trend_returns_runs_with_cadence`)

**Interfaces:**
- Consumes: nothing
- Produces: nothing (pure deletion) — verified by confirming zero remaining references

This is safe now because `dashboard/app.py` (rewritten in Task 7) and `dashboard/tabs/aerobic.py` (Task 4) never call `metrics.cadence_trend`.

- [ ] **Step 1: Confirm there are no remaining references before deleting**

Run: `grep -rn "cadence_trend" src/ dashboard/ tests/`
Expected output (exactly these two lines — the definition and its test, both about to be deleted):
```
src/metrics.py:216:def cadence_trend(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
tests/test_metrics.py:255:def test_cadence_trend_returns_runs_with_cadence(mem_conn):
```

- [ ] **Step 2: Delete the function from `src/metrics.py`**

Remove these lines from `src/metrics.py` (currently lines 216–229):

```python
def cadence_trend(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute(f"""
        SELECT
            a.start_date_local::DATE AS activity_date,
            a.name,
            ROUND(a.distance_km, 1) AS distance_km,
            sd.cadence_avg
        FROM activities a
        JOIN activity_streams_derived sd ON a.id = sd.activity_id
        WHERE a.category = 'running'
          AND sd.cadence_avg IS NOT NULL
          AND {_date_filter('a')}
        ORDER BY a.start_date_local
    """).df()


```

- [ ] **Step 3: Delete the test from `tests/test_metrics.py`**

Remove these lines from `tests/test_metrics.py` (currently lines 255–260):

```python
def test_cadence_trend_returns_runs_with_cadence(mem_conn):
    _insert_run_with_streams(mem_conn, 1, "2026-03-11T07:00:00", 10.0, 145.0, 10.5)
    df = metrics.cadence_trend(mem_conn)
    assert not df.empty
    assert float(df.iloc[0]["cadence_avg"]) == pytest.approx(172.5)


```

- [ ] **Step 4: Verify no references remain**

Run: `grep -rn "cadence_trend" src/ dashboard/ tests/`
Expected: no output (empty).

- [ ] **Step 5: Run the full test suite**

Run: `pytest -v`
Expected: all tests pass, with one fewer test than Task 7's run (the deleted `test_cadence_trend_returns_runs_with_cadence`).

- [ ] **Step 6: Final full-app smoke test**

Run:
```bash
timeout 20 python dashboard/app.py > /tmp/app_smoke2.log 2>&1
echo "EXIT:$?"
grep -iE "error|traceback|exception" /tmp/app_smoke2.log || echo "NO_ERRORS_FOUND"
```
Expected: `EXIT:0` and `NO_ERRORS_FOUND`.

- [ ] **Step 7: Commit**

```bash
git add src/metrics.py tests/test_metrics.py
git commit -m "$(cat <<'EOF'
refactor: remove dead cadence_trend metric and its test

No longer referenced anywhere now that the Aerobic Performance tab
was rebuilt without the cadence chart. DB columns (cadence_avg,
average_cadence) are left untouched — just unused going forward.
EOF
)"
```

---

## Post-plan cleanup note

`docs/superpowers/plans/2026-06-17-comrades-analytics.md`, `docs/superpowers/plans/2026-06-18-ultra-hub-dashboard.md`, and the untracked `training_plan.csv` / `training_plan_daily.csv` files visible in `git status` at plan-writing time are unrelated to this plan and are left untouched.
