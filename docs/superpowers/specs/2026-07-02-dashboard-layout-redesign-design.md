# Dashboard Layout Redesign

**Date:** 2026-07-02

## Goal

The dashboard is a single scrolling page with 14 stacked sections (~1100 lines in `dashboard/app.py`). This makes it hard to digest: too much scrolling, no clear priority between "check today" info and reference material, some redundant/overlapping charts, and dense chart-heavy sections. Also remove the cadence chart entirely — the user's watch doesn't track cadence, so the data is unreliable/absent.

## Approach

Reorganize into 5 top-level `st.tabs`, with a persistent header above the tabs holding the "glance and go" info. Split `dashboard/app.py` (currently one flat file) into a thin shell plus one render module per tab, so each tab's code is independently readable.

### Persistent header (always visible, above the tabs)

Unchanged content, same order as today:
- Title + "Show from" date filter
- 5 key metrics: Days to Race, This Week (km), Planned (km), Plan Adherence, Phase
- Highlights banner (narrative insight)

### Tabs

1. **Today** — the actionable view.
   - Risk-flag strip: ACWR, Weekly Ramp, Monotony, Long Run % as compact metric cards (value + 🟢🟡🔴 flag + one-line caption), no charts. Lets you spot a red flag without visiting Training Load.
   - Current week's daily training plan (reuses the existing daily-sessions renderer), always the week containing today — no week selector.

2. **Training Load** — how much and how hard.
   - Weekly Mileage (Distance / Time on Feet / Monthly sub-tabs, unchanged)
   - Long Run Progression chart
   - CTL/ATL/TSB chart
   - ACWR history chart
   - Weekly Ramp Rate chart
   - Training Load by Category chart
   - (Monotony and Long Run % have no dedicated chart today — flag values live on Today; no chart added here since none exists currently.)

3. **Aerobic Performance** — is training working physiologically.
   - Zone Analysis (HR zone stacked bars + 80/20 compliance), unchanged
   - Pace Trend
   - Aerobic Decoupling
   - Long Run Quality Score
   - Cadence chart removed (see below).

4. **Race Prep** — readiness for Comrades.
   - Race Calendar table + "Add race" form
   - Comrades Milestones metrics (6 cards) + medal bands + elevation gain chart + back-to-back table
   - Projected Splits table + elevation profile chart
   - Shoe Mileage

5. **Plan & History** — reference/admin, checked occasionally not daily.
   - "Import plan from CSV" form
   - All-weeks overview (expandable per-week drill-down, existing behavior)
   - Week selector + daily drill-down for any week (not just current)
   - Long Run Log table
   - Recent Activities table

### Cadence removal

- Delete the "Cadence Trend (spm)" chart and its column from the Aerobic Performance tab (currently the third column alongside Pace Trend / Decoupling).
- Delete `cad_df = metrics.cadence_trend(conn)` and the `metrics.cadence_trend()` function in `src/metrics.py` — it becomes dead code with no other callers.
- Leave the `cadence_avg` / `average_cadence` DB columns and their population in `src/db.py` / `src/sync.py` untouched — no schema migration, just unused going forward. `run_pace_trend()`'s incidental `sd.cadence_avg` select stays (harmless, not the source of the chart).
- Delete `test_cadence_trend_returns_runs_with_cadence` in `tests/test_metrics.py` (line ~255) since it directly tests the function being removed. All other cadence-related tests (parser, sync, db, streams) cover unrelated code paths (ingesting/storing `average_cadence`/`cadence_avg`) and stay untouched.

### Code structure

`dashboard/app.py` becomes a thin shell:
- Page config, DB connection, schema init
- Persistent header rendering (title, filter, top metrics, highlights) — stays inline in `app.py`, it's short and specific to the page top
- `st.tabs([...])` and one call per tab into its render function

New `dashboard/tabs/` package, one module per tab, each exposing a single `render(conn)` function that fetches its own data via `metrics.py` calls and renders directly (no shared context object — duckdb queries are cheap for this dataset size, and independent modules are easier to reason about than a fetch-once cache):
- `dashboard/tabs/today.py`
- `dashboard/tabs/training_load.py`
- `dashboard/tabs/aerobic.py`
- `dashboard/tabs/race_prep.py`
- `dashboard/tabs/plan_history.py`

New `dashboard/shared.py` for constants/helpers used across more than one tab module: `RACE_DATE`, `RACE_DISTANCE_KM`, `BANDS`, `_fmt_pace`, `_flag`, `_ICON`, `_INTENSITY_LABEL`, `_render_daily_sessions`, `_week_label`. `_render_daily_sessions` and `_week_label` are used by both `today.py` (current week only) and `plan_history.py` (any selected week).

## Non-goals

- No new metrics or charts beyond what exists today (aside from removing cadence).
- No changes to `periodization.py`, plan-building logic, or Strava sync behavior.
- No visual/CSS theming changes beyond what's needed to move content between tabs.
- Not moving to a native Streamlit multipage app (sidebar-based) — tabs were chosen over that in review.

## Testing

- Manual verification: run `streamlit run dashboard/app.py`, click through all 5 tabs, confirm every chart/table that existed before still renders in its new tab, confirm cadence chart is gone, confirm Today tab shows the current week's plan and risk flags.
- No existing automated tests cover `dashboard/app.py` layout (Streamlit UI code isn't unit tested in this repo).
- Removing `metrics.cadence_trend()` requires deleting `test_cadence_trend_returns_runs_with_cadence` in `tests/test_metrics.py`. Run the full `pytest` suite after the change to confirm nothing else references it.
