# Ultra Training Hub — Comrades 2027 Expansion Design

**Date:** 2026-06-18
**Goal:** Expand the existing Comrades 2027 Streamlit dashboard from a passive tracking tool into a full training intelligence hub, centred on a periodization engine driven by tune-up race events.

---

## Context

The existing dashboard (Streamlit + DuckDB + Strava sync) already covers: weekly volume, ACWR, zone breakdown, Z2 pace trend, aerobic decoupling, cadence, training plan adherence, Comrades milestones, and back-to-back run tracking. This design extends it with eight new features organised into three layers.

**Constraints:**
- Local-first: no external services, all computation in DuckDB/Python
- Check-in driven: no push alerts
- Tune-up races are training stimuli (run while fatigued) — mini-taper/recovery only, not full tapers
- Existing dashboard UI sections must continue to work during and after the migration

---

## Feature Set

### Layer 1 — Race Intelligence

**1. Race Calendar**
A `race_events` table stores each tune-up marathon or ultra with date, distance, priority (A or B), and target finish time. Once a race completes and Strava syncs it, the `strava_activity_id` is stamped on the row and analysis runs automatically.

**2. Full Periodization Engine**
Replaces `src/generate_daily_plan.py`. Reads Comrades date + all `race_events`, builds the full macro block structure backwards from race day, and regenerates the `training_plan` and `training_plan_daily` tables. The existing dashboard plan UI reads the same tables and requires no changes.

**3. Race Result Analysis**
At the end of every `sync.py` run, newly synced activities are checked against unlinked `race_events` (date ±1 day, distance ±10%). On match: streams are backfilled, zone breakdown + decoupling + pace data are extracted, and a Comrades finish projection is computed via the Riegel formula. Results are stored in `race_analysis` and surfaced in a dedicated dashboard panel.

### Layer 2 — Fitness Depth

**4. CTL/ATL/TSB Fitness-Form Chart**
Replaces the single ACWR history line chart with a proper fitness/fatigue/form curve. CTL (42-day EWA) and ATL (7-day EWA) on one axis, TSB (form = CTL − ATL) as a filled area on a second axis. Race event dates are vertical dashed markers. ACWR metric tile is retained as a secondary indicator.

**5. Long Run Quality Score**
Each long run ≥20km receives a composite quality score (0–100):
- Z2 compliance (% time in Z1+Z2): 40% weight
- Aerobic decoupling % inverted: 40% weight
- Pace coefficient of variation inverted: 20% weight

Displayed as a scatter chart with trendline inside the existing Aerobic Fitness section (new tab).

**6. Projected Comrades Splits**
Uses current best Z2 pace and the latest Riegel-derived projection to estimate cumulative time through five checkpoints: Cato Ridge (~30km), Drummond (~45km), Botha's Hill (~60km), Pinetown (~75km), Finish (~90km). Shown as a new tab inside the existing Comrades Milestones section, alongside a reference elevation profile chart.

### Layer 3 — Practical Ultra Tools

**7. Shoe Mileage Tracker**
Strava's `gear_id` field is synced onto each activity. A `gear` table auto-populates on first-seen gear IDs. The dashboard shows one card per shoe pair with cumulative km, a progress bar toward the retirement threshold (default 800km), and a colour flag (amber <100km remaining, red = past threshold).

**8. Comrades Course Comparison**
Weekly elevation gain vs a course-specific accumulation target is surfaced more prominently. Descent accumulation (already tracked in milestones) is moved to a dedicated chart showing weekly descent vs the 1800m net descent target.

---

## Data Model

### New Tables

```sql
CREATE TABLE race_events (
    id INTEGER PRIMARY KEY,
    name VARCHAR NOT NULL,
    race_date DATE NOT NULL,
    distance_km DOUBLE NOT NULL,
    priority VARCHAR NOT NULL CHECK (priority IN ('A', 'B')),
    target_finish_h DOUBLE,
    notes VARCHAR,
    strava_activity_id BIGINT  -- nullable, set after race syncs
);

CREATE TABLE training_blocks (
    id INTEGER PRIMARY KEY,
    block_type VARCHAR NOT NULL
        CHECK (block_type IN ('base','build','peak','taper','race_taper','recovery','deload')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    target_weekly_km DOUBLE,
    phase_label VARCHAR,
    race_event_id INTEGER REFERENCES race_events(id)  -- nullable
);

CREATE TABLE gear (
    id VARCHAR PRIMARY KEY,  -- Strava gear ID string e.g. 'g12345678'
    name VARCHAR NOT NULL,
    type VARCHAR CHECK (type IN ('road', 'trail')),
    added_date DATE,
    retire_km_threshold DOUBLE DEFAULT 800.0,
    is_retired BOOLEAN DEFAULT FALSE,
    notes VARCHAR
);

CREATE TABLE race_analysis (
    race_event_id INTEGER PRIMARY KEY REFERENCES race_events(id),
    activity_id BIGINT NOT NULL,
    avg_pace_min_km DOUBLE,
    comrades_projection_h DOUBLE,
    riegel_factor DOUBLE,
    computed_at TIMESTAMP DEFAULT current_timestamp
);
```

### Modified Tables

**`activities`** — two new columns:
```sql
ALTER TABLE activities ADD COLUMN gear_id VARCHAR;
ALTER TABLE activities ADD COLUMN gear_name VARCHAR;
```
Both sourced from Strava's activity response `gear_id` field. No extra API calls needed.

**`training_plan` + `training_plan_daily`** — schema unchanged. The periodization engine writes into them via the existing `upsert_training_plan_week` and `upsert_daily_session` helpers in `db.py`. `correlate_activities_to_plan` continues to run after each sync to mark completed sessions. Only `generate_daily_plan.py` is replaced.

---

## Periodization Engine

**File:** `src/periodization.py`

### Public Interface

```python
def build_plan(conn, comrades_date: date, race_events: list[dict]) -> None:
    """
    Clears and rebuilds training_blocks, training_plan, training_plan_daily.
    Wrapped in a transaction — rolls back on any failure so existing plan is never partially destroyed.
    """

def detect_and_analyse_race(conn, activity: dict) -> dict | None:
    """
    Called at end of sync.py for each new activity.
    Returns race analysis dict if activity matches a race_event, else None.
    Match criteria: date within ±1 day AND distance within ±10% of planned.
    Tie-break: closest distance match.
    """

def update_comrades_projection(conn, race_event_id: int, race_result: dict) -> float:
    """
    Riegel formula: T_comrades = T_race × (90 / race_distance_km) ^ 1.06
    Adjusted +4% for Comrades Down Run terrain (net descent, late-race heat).
    Writes to race_analysis, returns projected hours.
    """
```

### Pass 1 — Macro Block Builder

Works backwards from Comrades date:

| Window | Block type | Volume |
|--------|-----------|--------|
| Weeks −1 to −3 | `taper` | −15%, −25%, −40% of peak |
| Weeks −4 to −9 | `peak` | highest volume, B2B long runs |
| Remaining weeks | `build` (4-week cycles) | progressive +10%/week, every 4th = `deload` |
| From today to first build | `base` | aerobic foundation |

Each tune-up race punches into whatever block it falls in:

| Priority | Pre-race | Race day | Post-race |
|----------|----------|----------|-----------|
| A | 1-week `race_taper` (−25%, drop quality sessions) | Race | 1-week `recovery` (−35%, easy only) |
| B | 1-week `race_taper` (−15%, keep 1 quality session) | Race | 1-week `recovery` (−25%, easy only) |

### Pass 2 — Daily Session Generator

Weekly session templates by block type:

| Block | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|-------|-----|-----|-----|-----|-----|-----|-----|
| Base | Rest | Easy | Easy | Moderate | Rest/SC | Easy | Long |
| Build | Rest | Easy | Quality | Easy | Rest/SC | Easy | Long |
| Peak | Easy | Quality | Easy | Quality | Rest | Easy | Long |
| Taper | Rest | Easy | Quality | Easy | Rest | Easy | Med-long |
| Recovery | Rest | Easy | Easy | Rest | Rest | Easy | Easy-long |

Quality sessions rotate: hills → tempo → intervals (cycling per block). Long runs progress ~10%/week within a block, capped so long run never exceeds 35% of weekly volume (existing guard).

---

## Dashboard Changes

### New: Race Calendar section *(after header)*
- Table: name, date, distance, priority badge (A/B), target time, status (upcoming/completed/analysed)
- Expander: add-race form (name, date, distance_km, priority, target_finish_h, notes)
- On save: `build_plan` re-runs, plan updates immediately
- Completed + analysed races: expandable analysis panel inline

### New: Race Result Analysis panel *(inside race calendar, per completed race)*
- Zone breakdown bar chart (from `activity_streams_derived`)
- HR decoupling % vs 8-week trailing average
- Race pace plotted on existing Z2 pace trend scatter
- Updated Comrades projection with delta vs previous estimate
- Confidence note: "based on N races"

### Modified: Load & Risk section
- CTL/ATL/TSB dual-axis chart replaces ACWR history line chart
- ACWR metric tile retained alongside CTL/ATL/TSB tiles
- Race event dates as vertical dashed markers on CTL/ATL/TSB chart

### Modified: Aerobic Fitness section *(new tab)*
- Fourth tab "Long Run Quality" — scatter chart of runs ≥20km, dot sized by distance, coloured by composite quality score (0–100), OLS trendline

### New: Shoe Mileage Tracker section *(after Load & Risk)*
- One card per gear ID with: name, type badge, km run, progress bar, km remaining
- Amber flag: <100km to threshold; red flag: past threshold
- Callout if activities have no gear data (prompt to link gear in Strava)

### Modified: Comrades Milestones section *(new tab)*
- Second tab "Splits" — checkpoint table with projected cumulative time and time-of-day
- Comrades elevation profile reference chart below splits table
- Descent accumulation moved from milestone tiles to a dedicated weekly descent chart

---

## Data Flow

### Adding a race
```
User submits race form
→ INSERT into race_events
→ build_plan(conn, comrades_date, all race_events)
  → transaction: TRUNCATE training_blocks, training_plan, training_plan_daily
  → Pass 1: write training_blocks rows
  → Pass 2: write training_plan + training_plan_daily rows
  → COMMIT
→ dashboard re-renders
```

### Completing a race
```
sync.py runs
→ activity upserted (with gear_id, gear_name)
→ detect_and_analyse_race() for each new activity
  → match found (date ±1 day, distance ±10%)
  → streams backfilled if missing (one attempt; deferred if API fails)
  → race_analysis computed and written
  → strava_activity_id stamped on race_events row
→ dashboard shows analysis panel on next load
```

### Shoe tracking
```
sync.py runs
→ activity upserted with gear_id + gear_name (both from Strava activity response)
→ gear table: INSERT OR IGNORE on first seen gear_id, populating id + name only;
  type defaults to 'road', retire_km_threshold defaults to 800 — user can edit in UI
→ shoe km totals: computed at query time via GROUP BY gear_id (no separate counter)
```

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| `build_plan` fails midway | Transaction rolls back; existing plan preserved |
| Race detection: no match | Sync completes normally; race_event stays unlinked |
| Race detection: multiple candidates | Closest distance match wins |
| Streams backfill fails (rate limit) | Race analysis deferred; dashboard callout prompts `python src/backfill.py` |
| Activity has no gear_id | Nullable; silently skipped in shoe tracker |
| Race added with date in the past | Allowed; plan rebuilds with historical block; detection still runs on next sync |

---

## Testing

### New test files

**`tests/test_periodization.py`**
- Block builder: correct block sequence generated, race windows punched at correct dates, no overlapping blocks, deload every 4th week, A vs B race taper depth difference
- Daily session generator: correct session type per block, long-run % guard respected, quality rotation cycles correctly
- `update_comrades_projection`: Riegel formula correctness with known inputs, +4% terrain factor applied

**`tests/test_race_analysis.py`**
- Detection: match on date+distance, no match when date outside ±1 day, no match when distance outside ±10%, tie-break selects closer distance
- Projection update: written to `race_analysis`, `strava_activity_id` stamped on `race_events`

### Existing tests
All existing tests pass unchanged. `build_plan` writes into the same tables the current fixtures cover; no fixture changes required.

---

## File Map (additions only)

```
src/
  periodization.py      # block builder, daily session generator, race detection, projection
  generate_daily_plan.py  # DELETED (replaced by periodization.py)

tests/
  test_periodization.py
  test_race_analysis.py
```

All other files (`db.py`, `sync.py`, `metrics.py`, `dashboard/app.py`) are modified in-place.
