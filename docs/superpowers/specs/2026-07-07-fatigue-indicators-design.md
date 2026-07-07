# Fatigue Indicators Reorganization — Design

**Date:** 2026-07-07
**Status:** Approved, pending plan

## Motivation

Fatigue-relevant signals are currently scattered across three tabs with no
consistent framing:

- **Today tab** shows ACWR, Weekly Ramp, Monotony, and Long Run % as four
  flat metric cards in one row, as if they measure the same thing. They
  don't: ACWR/Ramp/Monotony describe *training-pattern* risk, Long Run %
  describes *single-session* risk.
- **Training Load tab** has the CTL/ATL/TSB chart (the one true Banister
  fatigue/form model) filed under a generic "Training Load & Fitness"
  header, plus duplicate ACWR/Ramp charts.
- **Aerobic Performance tab** has aerobic decoupling (cardiac drift), which
  is itself a real-time physiological fatigue signal, framed purely as an
  "aerobic fitness" metric.

Two existing backend calculations are computed but never surfaced in any
tab: `weekly_monotony()`'s `strain` column (`src/metrics.py:129`), and
`back_to_back_runs()` (`src/metrics.py:338`).

This reorganization does not add any new data sources (no Apple Health, no
subjective wellness log — deferred). Everything below is computable from
data already in `activities` / `activity_streams_derived`.

## Goals

- Group fatigue-relevant signals into a dedicated **Fatigue** tab, organized
  by what each signal actually measures, not by which chart library call
  happened to produce it.
- Surface two already-computed-but-unused signals: strain and
  back-to-back long runs.
- Add two new derived views from existing columns: weekly Aerobic
  Efficiency Factor (EF) trend, and a long-run-% trend chart (data already
  computed by `long_run_pct()`, currently only used for a single latest-value
  card on Today).
- Leave Today, Training Load, and Aerobic tabs focused on their narrower
  purpose (daily plan check-in, volume/mileage, aerobic performance) once
  fatigue content moves out.

## Non-goals

- No new external data sources (Apple Health, HRV, resting HR).
- No subjective wellness logging (sleep/soreness/RPE input).
- No changes to how `load_score`, ACWR, monotony, or TSB are calculated —
  this is a presentation/organization change, not a metrics-formula change,
  except for the two new derived views below.

## Taxonomy

Four categories, each becomes a labeled section in the new Fatigue tab:

| Category | Signals | Question it answers |
|---|---|---|
| Form & Freshness | CTL, ATL, TSB, weekly EF (new) | How tired am I right now relative to my fitness base? |
| Overreaching Risk | ACWR, Weekly Ramp Rate, Monotony, Strain (surfaced) | Is my recent training *pattern* likely to produce fatigue/injury? |
| Session/Structural Risk | Long Run %, back-to-back long runs (surfaced), weekly elevation gain | Is any single session or short sequence of sessions overloading me structurally? |
| In-Session Physiological Fatigue | Aerobic decoupling (cross-referenced) | Is my heart rate drifting relative to pace within a run, right now? |

## New Fatigue Tab

New file `dashboard/tabs/fatigue.py`, registered in `dashboard/app.py` as a
tab titled "Fatigue", positioned second (`Today, Fatigue, Training Load,
Aerobic Performance, Race Prep, Plan & History`).

### Section 1 — Form & Freshness

- Metric cards: TSB (existing `flag()` styling, thresholds unchanged), and
  a new EF card showing latest weekly mean EF with a trend arrow (↑/↓/→
  based on 4-week slope sign) — no color flag, since EF has no universal
  absolute threshold.
- CTL/ATL/TSB chart: moved as-is from `training_load.py` (`ctl_atl_tsb_history`),
  including race-date vlines and existing caption.
- New: Weekly EF trend chart. EF = `average_speed_kmh / average_heartrate`
  per run, averaged per week. Line chart with OLS trendline, same visual
  pattern as the existing pace-trend chart in `aerobic.py`. Caption
  explains: rising EF at stable/rising load = good aerobic adaptation;
  falling EF despite stable load = early fatigue/overreaching signal.
- **Backend addition:** `metrics.weekly_efficiency_factor(conn)` — new
  function returning `week_start, mean_ef, run_count` by aggregating the
  same joined `activities`/`activity_streams_derived` data `run_pace_trend()`
  uses, filtered to weeks with ≥2 qualifying runs (avoids single-run noise
  dominating a week's average). Added to `src/metrics.py` near
  `run_pace_trend`.

### Section 2 — Overreaching Risk

- Metric cards: ACWR, Ramp %, Monotony (all existing, `flag()` thresholds
  unchanged), and new Strain card. Strain flag is *relative*, not absolute:
  🟢 if current week's strain ≤ trailing 4-week average, 🟡 if 1–2×, 🔴 if
  >2×. Computed in the tab layer via `weekly_monotony(conn)` (already
  returns `strain`) with a `.rolling(4).mean().shift(1)` comparison column,
  matching the existing pattern used for `rolling_4w_avg` in
  `training_load.py`.
- ACWR history + Ramp rate charts: moved as-is (same two-column layout)
  from `training_load.py`.
- New: Monotony/Strain combo chart — monotony as a line (primary y-axis),
  strain as bars (secondary y-axis), x-axis = week. Built directly from
  `weekly_monotony(conn)`, no new backend needed. Purpose: visually surface
  weeks where high monotony coincides with high load.

### Section 3 — Session/Structural Risk

- Metric card: Long Run % (moved from Today, `flag()` thresholds unchanged:
  0–35 green).
- New: Long Run % trend chart — line chart of `long_run_pct(conn)` over
  time with the existing 35% threshold hline. Data already computed;
  today it's only used for the single latest-value card.
- New: Back-to-back long runs. Metric card showing count of instances in
  the trailing 4 weeks from `back_to_back_runs(conn, min_km=15.0)`
  (🟢 0–1, 🟡 2, 🔴 3+), plus a small table below listing recent instances
  (`day1`, `day2`, `day1_km`, `day2_km`, `combined_km`), most recent first,
  capped at 10 rows.
- New: Weekly elevation gain chart from existing `weekly_elevation(conn)`,
  with a 4-week rolling average line (same pattern as the weekly-volume
  chart) and current week flagged red if it exceeds 1.5× the rolling
  average. Caption notes relevance to Comrades' climbing despite being the
  "down" run.

### Section 4 — In-Session Physiological Fatigue (cross-reference)

- Single metric card: latest decoupling % (reuse `run_pace_trend(conn)`,
  take most recent non-null `decoupling_pct`), same `flag()` styling as
  used implicitly in `aerobic.py`'s color-scale bar chart, but here just a
  single number.
- Caption: "Full trend and long-run quality score → Aerobic Performance
  tab." No chart duplicated here.

## Changes to Existing Tabs

- **`dashboard/tabs/today.py`**: remove the 4-metric row (ACWR, Ramp,
  Monotony, Long Run %) and its associated `metrics.*` calls. Replace with
  a single-line info banner pointing to the Fatigue tab (style: same
  `st.info`/`st.warning` pattern already used for highlights in `app.py`).
  Rest of Today (plan progress, daily sessions) is unchanged.
- **`dashboard/tabs/training_load.py`**: remove the "Training Load &
  Fitness" section (CTL/ATL/TSB chart, ACWR history chart, ramp rate
  chart) — all moved to the new Fatigue tab. Weekly Mileage, Long Run
  Progression, and Training Load by Category sections are unchanged.
- **`dashboard/tabs/aerobic.py`**: unchanged. No caption changes needed
  (the cross-reference is one-directional, from Fatigue → Aerobic).
- **`dashboard/app.py`**: add `fatigue` to the tab import and `st.tabs(...)`
  call, positioned second.

## Backend Changes

Only one new function, everything else reuses existing `metrics.py`
functions unchanged:

- `metrics.weekly_efficiency_factor(conn)` — new, described above.

No changes to `src/db.py` schema, `src/sync.py`, or any existing metric's
calculation logic (ACWR, monotony, strain, TSB formulas are untouched —
this is purely about surfacing and grouping existing numbers).

## Testing

- `tests/test_metrics.py`: add tests for `weekly_efficiency_factor` —
  empty-data case, single-run week excluded (below the ≥2-run threshold),
  normal multi-week aggregation case. Follow existing fixture patterns in
  that file (in-memory DuckDB connection, seeded `activities` rows).
- No new tests for tab-layer pandas transforms (rolling averages, flag
  thresholds embedded in `fatigue.py`) — consistent with existing
  convention that `dashboard/tabs/*.py` view code is not unit tested;
  `tests/test_dashboard_shared.py` only covers `shared.py` helpers, not
  tab render functions.
- Manual verification: run `streamlit run dashboard/app.py`, confirm the
  Fatigue tab renders all four sections with real data, confirm Today and
  Training Load tabs no longer show the moved content, confirm no tab
  throws on empty-data (no activities synced yet) — existing tabs already
  guard this with `if not df.empty` checks; new sections must follow the
  same guard pattern.

## File-Level Change List

- `dashboard/tabs/fatigue.py` — new file
- `dashboard/app.py` — import + register new tab
- `dashboard/tabs/today.py` — remove fatigue metric row, add banner
- `dashboard/tabs/training_load.py` — remove Training Load & Fitness section
- `src/metrics.py` — add `weekly_efficiency_factor(conn)`
- `tests/test_metrics.py` — add tests for the new function
