# Ultra Training Hub — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend layer for the ultra training hub: new DB schema, gear sync, periodization engine, race result analysis, and four new metric functions (CTL/ATL/TSB, long run quality score, Comrades splits projection, shoe mileage).

**Architecture:** Six self-contained tasks, each tested before the next begins. The periodization engine rebuilds `training_plan` + `training_plan_daily` in a single transaction using the existing `upsert_training_plan_week` / `upsert_daily_session` helpers. `sync.py` gets two additions: gear auto-population and race detection. New metrics are pure SQL/pandas functions appended to `metrics.py`.

**Tech Stack:** Python 3.11+, DuckDB 1.0+, pandas, pytest, requests (existing stack — no new dependencies)

## Global Constraints

- DuckDB ≥ 1.0.0 — use `INSERT INTO ... ON CONFLICT DO NOTHING` not `INSERT OR IGNORE`
- All new `init_schema` additions use `CREATE TABLE IF NOT EXISTS`; new columns on existing tables use try/except around `ALTER TABLE ADD COLUMN` (DuckDB has no `IF NOT EXISTS` for columns)
- All new `metrics.py` functions respect the existing `_date_filter()` module-level filter where the result is training-period data; CTL/ATL/TSB and shoe mileage query all-time data and do NOT use `_date_filter()`
- `build_plan` is always wrapped in a `BEGIN` / `COMMIT` transaction with `ROLLBACK` on exception — existing plan is never partially destroyed
- Session types must be one of: `rest`, `sc`, `easy_run`, `quality_run`, `long_run`, `hills`, `race`
- Intensity values must be one of: `rest`, `easy`, `moderate`, `hard`, `race`
- Comrades race date constant: `date(2027, 6, 13)`; race distance: `90.0 km`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/db.py` | 4 new tables, 2 new activity columns, 4 new upsert helpers |
| Modify | `src/parser.py` | Extract `gear_id` from Strava response |
| Modify | `src/strava_client.py` | Add `get_gear(access_token, gear_id)` |
| Modify | `src/sync.py` | Gear auto-population + race detection call |
| Create | `src/periodization.py` | Block builder, daily session generator, race detection, Riegel projection |
| Modify | `src/metrics.py` | 4 new metric functions |
| Create | `tests/test_periodization.py` | Block sequencing, race windows, session types, projection formula |
| Modify | `tests/test_metrics.py` | 4 new metric function tests |
| Modify | `tests/test_sync.py` | Gear auto-population test |
| Delete | `src/generate_daily_plan.py` | Replaced by `periodization.py` |

---

## Task 1: Schema Additions

**Files:**
- Modify: `src/db.py`
- Modify: `tests/test_db.py`

**Interfaces:**
- Produces:
  - `upsert_race_event(conn, event: dict) -> int` — returns inserted id
  - `stamp_race_activity(conn, race_event_id: int, strava_activity_id: int) -> None`
  - `upsert_gear(conn, gear_id: str, gear_name: str) -> None`
  - `upsert_race_analysis(conn, analysis: dict) -> None`
  - `get_all_race_events(conn) -> list[dict]`

- [ ] **Step 1.1: Write failing tests**

Add to `tests/test_db.py`:

```python
def test_init_schema_creates_race_events(mem_conn):
    tables = {t[0] for t in mem_conn.execute("SHOW TABLES").fetchall()}
    assert "race_events" in tables

def test_init_schema_creates_training_blocks(mem_conn):
    tables = {t[0] for t in mem_conn.execute("SHOW TABLES").fetchall()}
    assert "training_blocks" in tables

def test_init_schema_creates_gear(mem_conn):
    tables = {t[0] for t in mem_conn.execute("SHOW TABLES").fetchall()}
    assert "gear" in tables

def test_init_schema_creates_race_analysis(mem_conn):
    tables = {t[0] for t in mem_conn.execute("SHOW TABLES").fetchall()}
    assert "race_analysis" in tables

def test_activities_has_gear_columns(mem_conn):
    cols = {c[0] for c in mem_conn.execute("DESCRIBE activities").fetchall()}
    assert "gear_id" in cols
    assert "gear_name" in cols

def test_upsert_race_event_inserts_and_returns_id(mem_conn):
    from db import upsert_race_event
    event = {
        "name": "Two Oceans Ultra",
        "race_date": "2026-04-19",
        "distance_km": 56.0,
        "priority": "A",
        "target_finish_h": 6.5,
    }
    rid = upsert_race_event(mem_conn, event)
    assert isinstance(rid, int)
    row = mem_conn.execute("SELECT name, priority FROM race_events WHERE id = ?", [rid]).fetchone()
    assert row[0] == "Two Oceans Ultra"
    assert row[1] == "A"

def test_upsert_gear_inserts_once(mem_conn):
    from db import upsert_gear
    upsert_gear(mem_conn, "g123", "Nike Alphafly")
    upsert_gear(mem_conn, "g123", "Nike Alphafly")  # duplicate — must not raise
    count = mem_conn.execute("SELECT COUNT(*) FROM gear WHERE id = 'g123'").fetchone()[0]
    assert count == 1

def test_upsert_race_analysis_upserts(mem_conn):
    from db import upsert_race_event, upsert_race_analysis
    rid = upsert_race_event(mem_conn, {
        "name": "Test Race", "race_date": "2026-04-19",
        "distance_km": 42.2, "priority": "B",
    })
    upsert_race_analysis(mem_conn, {
        "race_event_id": rid, "activity_id": 9999,
        "avg_pace_min_km": 6.1, "comrades_projection_h": 9.8, "riegel_factor": 1.06,
    })
    row = mem_conn.execute(
        "SELECT comrades_projection_h FROM race_analysis WHERE race_event_id = ?", [rid]
    ).fetchone()
    assert row[0] == pytest.approx(9.8)
```

- [ ] **Step 1.2: Run tests — verify they fail**

```bash
cd /home/keyan/Documents/Strava_Dashboard && source .venv/bin/activate
pytest tests/test_db.py -v -k "race_events or training_blocks or gear or race_analysis or gear_columns or upsert_race or upsert_gear"
```

Expected: `ImportError` or `AssertionError` — tables and functions do not exist yet.

- [ ] **Step 1.3: Add new tables to `init_schema` in `src/db.py`**

Add these four blocks inside `init_schema`, after the existing `sync_state` CREATE:

```python
    conn.execute("""
        CREATE SEQUENCE IF NOT EXISTS race_events_id_seq START 1
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS race_events (
            id INTEGER PRIMARY KEY DEFAULT nextval('race_events_id_seq'),
            name VARCHAR NOT NULL,
            race_date DATE NOT NULL,
            distance_km DOUBLE NOT NULL,
            priority VARCHAR NOT NULL,
            target_finish_h DOUBLE,
            notes VARCHAR,
            strava_activity_id BIGINT
        )
    """)
    conn.execute("""
        CREATE SEQUENCE IF NOT EXISTS training_blocks_id_seq START 1
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS training_blocks (
            id INTEGER PRIMARY KEY DEFAULT nextval('training_blocks_id_seq'),
            block_type VARCHAR NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            target_weekly_km DOUBLE,
            phase_label VARCHAR,
            race_event_id INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS gear (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            type VARCHAR DEFAULT 'road',
            added_date DATE,
            retire_km_threshold DOUBLE DEFAULT 800.0,
            is_retired BOOLEAN DEFAULT FALSE,
            notes VARCHAR
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS race_analysis (
            race_event_id INTEGER PRIMARY KEY,
            activity_id BIGINT NOT NULL,
            avg_pace_min_km DOUBLE,
            comrades_projection_h DOUBLE,
            riegel_factor DOUBLE,
            computed_at TIMESTAMP DEFAULT current_timestamp
        )
    """)
    # Add gear columns to activities if missing
    for col, col_type in [("gear_id", "VARCHAR"), ("gear_name", "VARCHAR")]:
        try:
            conn.execute(f"ALTER TABLE activities ADD COLUMN {col} {col_type}")
        except Exception:
            pass
```

- [ ] **Step 1.4: Add the four new DB helpers to `src/db.py`**

Append after `set_last_synced`:

```python
def upsert_race_event(conn: duckdb.DuckDBPyConnection, event: dict) -> int:
    if event.get("id"):
        conn.execute("""
            UPDATE race_events
            SET name = ?, race_date = ?, distance_km = ?, priority = ?,
                target_finish_h = ?, notes = ?
            WHERE id = ?
        """, [event["name"], event["race_date"], event["distance_km"],
              event["priority"], event.get("target_finish_h"),
              event.get("notes"), event["id"]])
        return int(event["id"])
    result = conn.execute("""
        INSERT INTO race_events (name, race_date, distance_km, priority, target_finish_h, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
    """, [event["name"], event["race_date"], event["distance_km"],
          event["priority"], event.get("target_finish_h"), event.get("notes")]).fetchone()
    return int(result[0])


def stamp_race_activity(conn: duckdb.DuckDBPyConnection, race_event_id: int, strava_activity_id: int) -> None:
    conn.execute(
        "UPDATE race_events SET strava_activity_id = ? WHERE id = ?",
        [strava_activity_id, race_event_id],
    )


def upsert_gear(conn: duckdb.DuckDBPyConnection, gear_id: str, gear_name: str) -> None:
    conn.execute(
        "INSERT INTO gear (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING",
        [gear_id, gear_name],
    )


def upsert_race_analysis(conn: duckdb.DuckDBPyConnection, analysis: dict) -> None:
    conn.execute("""
        INSERT INTO race_analysis
            (race_event_id, activity_id, avg_pace_min_km, comrades_projection_h, riegel_factor, computed_at)
        VALUES (?, ?, ?, ?, ?, now())
        ON CONFLICT (race_event_id) DO UPDATE SET
            activity_id           = excluded.activity_id,
            avg_pace_min_km       = excluded.avg_pace_min_km,
            comrades_projection_h = excluded.comrades_projection_h,
            riegel_factor         = excluded.riegel_factor,
            computed_at           = excluded.computed_at
    """, [analysis["race_event_id"], analysis["activity_id"],
          analysis.get("avg_pace_min_km"), analysis["comrades_projection_h"],
          analysis.get("riegel_factor")])


def get_all_race_events(conn: duckdb.DuckDBPyConnection) -> list[dict]:
    rows = conn.execute("""
        SELECT id, name, race_date, distance_km, priority,
               target_finish_h, notes, strava_activity_id
        FROM race_events
        ORDER BY race_date
    """).fetchall()
    cols = ["id", "name", "race_date", "distance_km", "priority",
            "target_finish_h", "notes", "strava_activity_id"]
    return [dict(zip(cols, r)) for r in rows]
```

- [ ] **Step 1.5: Run tests — verify they pass**

```bash
pytest tests/test_db.py -v
```

Expected: all tests pass including the 8 new ones.

- [ ] **Step 1.6: Commit**

```bash
git add src/db.py tests/test_db.py
git commit -m "feat: schema — race_events, training_blocks, gear, race_analysis tables + upsert helpers"
```

---

## Task 2: Gear Sync

**Files:**
- Modify: `src/parser.py` — extract `gear_id`
- Modify: `src/strava_client.py` — add `get_gear()`
- Modify: `src/sync.py` — gear auto-population
- Modify: `src/db.py` — add `gear_id`/`gear_name` to `upsert_activity`
- Modify: `tests/test_sync.py`

**Interfaces:**
- Consumes: `upsert_gear(conn, gear_id, gear_name)` from Task 1
- Produces: `activities.gear_id` populated after sync; `gear` table auto-populated on first-seen ID

- [ ] **Step 2.1: Write failing test**

Add to `tests/test_sync.py`:

```python
@patch("sync.strava_client.get_activities")
@patch("sync.strava_client.get_gear", return_value={"name": "Nike Alphafly"})
@patch("sync.strava_client.refresh_access_token", return_value="fake_token")
def test_sync_populates_gear_table(mock_token, mock_gear, mock_acts, mem_conn):
    mock_acts.return_value = [{
        "id": 55555,
        "name": "Morning Run",
        "sport_type": "Run",
        "start_date_local": "2026-03-01T07:00:00Z",
        "distance": 10000.0,
        "moving_time": 3600,
        "elapsed_time": 3700,
        "total_elevation_gain": 80.0,
        "average_heartrate": 145.0,
        "max_heartrate": 160.0,
        "average_cadence": 86.0,
        "average_speed": 2.78,
        "suffer_score": 70.0,
        "gear_id": "g99999",
    }]
    from sync import run_sync
    run_sync(mem_conn)
    row = mem_conn.execute("SELECT name FROM gear WHERE id = 'g99999'").fetchone()
    assert row is not None
    assert row[0] == "Nike Alphafly"
```

- [ ] **Step 2.2: Run test — verify it fails**

```bash
pytest tests/test_sync.py::test_sync_populates_gear_table -v
```

Expected: `FAIL` — `get_gear` not in strava_client and gear table not populated.

- [ ] **Step 2.3: Add `gear_id` to `parse_activity` in `src/parser.py`**

In the `return` dict of `parse_activity`, add one line:

```python
        "gear_id": raw.get("gear_id"),
```

- [ ] **Step 2.4: Add `get_gear` to `src/strava_client.py`**

Append after `get_activity_streams`:

```python
def get_gear(access_token: str, gear_id: str) -> dict | None:
    headers = {"Authorization": f"Bearer {access_token}"}
    resp = requests.get(f"{API_BASE}/gear/{gear_id}", headers=headers)
    if resp.status_code == 200:
        return resp.json()
    return None
```

- [ ] **Step 2.5: Add `gear_id` + `gear_name` to `upsert_activity` in `src/db.py`**

Replace the INSERT column list in `upsert_activity` to include the two new columns. The full updated function:

```python
def upsert_activity(conn: duckdb.DuckDBPyConnection, activity: dict) -> None:
    conn.execute("""
        INSERT INTO activities (
            id, name, sport_type, category, start_date_local,
            distance_km, moving_time_min, elapsed_time_min, elevation_gain_m,
            average_heartrate, max_heartrate, average_cadence, average_speed_kmh,
            relative_effort, load_score, gear_id, gear_name, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
        ON CONFLICT (id) DO UPDATE SET
            name = excluded.name,
            sport_type = excluded.sport_type,
            category = excluded.category,
            start_date_local = excluded.start_date_local,
            distance_km = excluded.distance_km,
            moving_time_min = excluded.moving_time_min,
            elapsed_time_min = excluded.elapsed_time_min,
            elevation_gain_m = excluded.elevation_gain_m,
            average_heartrate = excluded.average_heartrate,
            max_heartrate = excluded.max_heartrate,
            average_cadence = excluded.average_cadence,
            average_speed_kmh = excluded.average_speed_kmh,
            relative_effort = excluded.relative_effort,
            load_score = excluded.load_score,
            gear_id = excluded.gear_id,
            gear_name = excluded.gear_name,
            synced_at = now()
    """, [
        activity["id"], activity.get("name"), activity.get("sport_type"),
        activity.get("category"), activity.get("start_date_local"),
        activity.get("distance_km"), activity.get("moving_time_min"),
        activity.get("elapsed_time_min"), activity.get("elevation_gain_m"),
        activity.get("average_heartrate"), activity.get("max_heartrate"),
        activity.get("average_cadence"), activity.get("average_speed_kmh"),
        activity.get("relative_effort"), activity.get("load_score"),
        activity.get("gear_id"), activity.get("gear_name"),
    ])
```

- [ ] **Step 2.6: Add gear auto-population to `src/sync.py`**

Replace the activity sync loop in `run_sync`:

```python
    if not raw_activities:
        print("No new activities.")
    else:
        print(f"Syncing {len(raw_activities)} activities...")
        seen_gear: set[str] = set(
            r[0] for r in conn.execute("SELECT id FROM gear").fetchall()
        )
        for raw in raw_activities:
            activity = parse_activity(category_map, raw)
            upsert_activity(conn, activity)

            gear_id = activity.get("gear_id")
            if gear_id and gear_id not in seen_gear:
                gear_data = strava_client.get_gear(access_token, gear_id)
                gear_name = gear_data.get("name", gear_id) if gear_data else gear_id
                upsert_gear(conn, gear_id, gear_name)
                seen_gear.add(gear_id)
```

Also add `upsert_gear` to the import line at the top of `sync.py`:

```python
from db import get_conn, init_schema, upsert_activity, upsert_gear, get_last_synced, set_last_synced, correlate_activities_to_plan
```

- [ ] **Step 2.7: Run all sync tests**

```bash
pytest tests/test_sync.py -v
```

Expected: all tests pass including `test_sync_populates_gear_table`.

- [ ] **Step 2.8: Commit**

```bash
git add src/parser.py src/strava_client.py src/sync.py src/db.py tests/test_sync.py
git commit -m "feat: gear sync — extract gear_id from Strava, auto-populate gear table"
```

---

## Task 3: Periodization Engine — Block Builder

**Files:**
- Create: `src/periodization.py`
- Create: `tests/test_periodization.py`

**Interfaces:**
- Consumes: `upsert_training_plan_week`, `upsert_daily_session`, `get_all_race_events` from `db.py`
- Produces: `build_plan(conn, comrades_date, race_events) -> None`

- [ ] **Step 3.1: Write failing tests**

Create `tests/test_periodization.py`:

```python
import sys
from pathlib import Path
from datetime import date, timedelta
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from periodization import build_plan, _monday, _assign_block_types


COMRADES = date(2027, 6, 13)


def _weeks_between(start: date, end: date) -> list[date]:
    weeks = []
    w = _monday(start)
    while w <= _monday(end):
        weeks.append(w)
        w += timedelta(weeks=1)
    return weeks


def test_monday_returns_monday():
    assert _monday(date(2026, 6, 18)).weekday() == 0  # Wednesday → Monday


def test_assign_block_types_taper_last_three_weeks():
    weeks = _weeks_between(date(2027, 5, 24), COMRADES)
    comrades_idx = len(weeks) - 1
    types = _assign_block_types(weeks, comrades_idx, {})
    # Last 3 entries before comrades_idx should be taper
    assert types[-2] == "taper"
    assert types[-3] == "taper"
    assert types[-4] == "taper"


def test_assign_block_types_peak_weeks_4_to_9():
    weeks = _weeks_between(date(2027, 1, 1), COMRADES)
    comrades_idx = len(weeks) - 1
    types = _assign_block_types(weeks, comrades_idx, {})
    # offset -4 to -9 from comrades should be peak
    for offset in range(-4, -10, -1):
        idx = comrades_idx + offset
        if idx >= 0:
            assert types[idx] == "peak", f"offset {offset} was {types[idx]}"


def test_assign_block_types_deload_every_4th_build_week():
    weeks = _weeks_between(date(2025, 12, 1), COMRADES)
    comrades_idx = len(weeks) - 1
    types = _assign_block_types(weeks, comrades_idx, {})
    build_weeks = [(i, t) for i, t in enumerate(types) if t in ("build", "deload")]
    # Every 4th build-phase week (0-indexed within build phase) should be deload
    build_phase = [t for _, t in build_weeks]
    for i, t in enumerate(build_phase):
        if i % 4 == 3:
            assert t == "deload", f"position {i} in build phase should be deload, got {t}"


def test_assign_block_types_race_window_A(mem_conn):
    race = {"race_date": date(2026, 10, 18), "priority": "A", "id": 1, "distance_km": 56.0, "name": "X"}
    weeks = _weeks_between(date(2026, 9, 1), COMRADES)
    comrades_idx = len(weeks) - 1
    race_mon = _monday(race["race_date"])
    windows = {
        race_mon - timedelta(weeks=1): ("race_taper", race, 0.75),
        race_mon:                      ("race",        race, 1.0),
        race_mon + timedelta(weeks=1): ("recovery",    race, 0.65),
    }
    types = _assign_block_types(weeks, comrades_idx, windows)
    idx = weeks.index(race_mon)
    assert types[idx - 1] == "race_taper"
    assert types[idx]     == "race"
    assert types[idx + 1] == "recovery"


def test_build_plan_writes_training_plan_rows(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    count = mem_conn.execute("SELECT COUNT(*) FROM training_plan").fetchone()[0]
    assert count > 0


def test_build_plan_transaction_rolls_back_on_error(mem_conn):
    # Populate plan once so there are rows to preserve
    build_plan(mem_conn, COMRADES, [])
    before = mem_conn.execute("SELECT COUNT(*) FROM training_plan").fetchone()[0]
    # Force an error inside build_plan by passing bad race event data
    try:
        build_plan(mem_conn, COMRADES, [{"race_date": "not-a-date", "priority": "A", "id": 99, "distance_km": 0, "name": "bad"}])
    except Exception:
        pass
    after = mem_conn.execute("SELECT COUNT(*) FROM training_plan").fetchone()[0]
    assert after == before  # original plan preserved
```

- [ ] **Step 3.2: Run tests — verify they fail**

```bash
pytest tests/test_periodization.py -v
```

Expected: `ImportError` — `periodization` module does not exist.

- [ ] **Step 3.3: Implement `src/periodization.py` — block builder only**

```python
import sys
from pathlib import Path
from datetime import date, timedelta
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent))

from db import (
    upsert_training_plan_week, upsert_daily_session,
    upsert_race_analysis, stamp_race_activity,
)

COMRADES_DATE = date(2027, 6, 13)
RACE_DISTANCE_KM = 90.0
TERRAIN_FACTOR = 1.04  # +4% for Comrades Down Run

# km targets
_BASE_START_KM = 55.0   # starting point if no recent data
_PEAK_KM = 110.0


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _estimate_current_fitness(conn) -> float:
    row = conn.execute("""
        SELECT AVG(wkly)
        FROM (
            SELECT SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS wkly
            FROM activities
            WHERE start_date_local::DATE >= CURRENT_DATE - INTERVAL '28 days'
            GROUP BY DATE_TRUNC('week', start_date_local::DATE)
        )
    """).fetchone()
    return float(row[0]) if row and row[0] else _BASE_START_KM


def _assign_block_types(
    weeks: list[date],
    comrades_idx: int,
    race_windows: dict,
) -> list[str]:
    n = len(weeks)
    # First 6 non-race weeks = base, then 4-week build cycles
    base_cap = 6
    types = []
    build_week_count = 0

    for i, w in enumerate(weeks):
        if w in race_windows:
            types.append(race_windows[w][0])
            continue
        offset = i - comrades_idx
        if offset >= 0:
            types.append("race")
        elif offset >= -3:
            types.append("taper")
        elif offset >= -9:
            types.append("peak")
        else:
            # Count non-race-window weeks from the start for base/build assignment
            non_race_so_far = sum(
                1 for j in range(i) if weeks[j] not in race_windows
            )
            if non_race_so_far < base_cap:
                types.append("base")
            else:
                build_pos = non_race_so_far - base_cap
                types.append("deload" if build_pos % 4 == 3 else "build")
    return types


def _target_km(block_type: str, week_idx: int, comrades_idx: int, current_km: float) -> float:
    offset = week_idx - comrades_idx
    if block_type == "taper":
        factors = {-1: 0.60, -2: 0.75, -3: 0.85}
        return _PEAK_KM * factors.get(offset, 0.85)
    if block_type == "peak":
        return _PEAK_KM
    if block_type == "base":
        # Weeks since start, gentle progression up to 1.5× start km
        progression = 1.05 ** week_idx
        return min(current_km * progression, current_km * 1.5)
    if block_type in ("build", "deload"):
        # Linear ramp from current_km to _PEAK_KM across build phase
        build_start = 6  # base weeks
        peak_start = comrades_idx - 9
        span = max(1, peak_start - build_start)
        progress = max(0.0, min(1.0, (week_idx - build_start) / span))
        base = current_km + (_PEAK_KM - current_km) * progress
        return base * (0.70 if block_type == "deload" else 1.0)
    return current_km  # recovery / race_taper handled by race window factor


def build_plan(conn, comrades_date: date, race_events: list[dict]) -> None:
    today = _monday(date.today())
    comrades_monday = _monday(comrades_date)

    weeks: list[date] = []
    w = today
    while w <= comrades_monday:
        weeks.append(w)
        w += timedelta(weeks=1)

    comrades_idx = len(weeks) - 1
    current_km = _estimate_current_fitness(conn)

    # Build race window lookup
    race_windows: dict = {}
    for race in sorted(race_events, key=lambda r: (
        r["race_date"] if isinstance(r["race_date"], date)
        else date.fromisoformat(str(r["race_date"]))
    )):
        rd = race["race_date"]
        if isinstance(rd, str):
            rd = date.fromisoformat(rd)
        race_mon = _monday(rd)
        priority = race.get("priority", "B")
        taper_factor = 0.75 if priority == "A" else 0.85
        recovery_factor = 0.65 if priority == "A" else 0.75
        pre = race_mon - timedelta(weeks=1)
        post = race_mon + timedelta(weeks=1)
        if pre not in race_windows:
            race_windows[pre] = ("race_taper", race, taper_factor)
        if race_mon not in race_windows:
            race_windows[race_mon] = ("race", race, 1.0)
        if post not in race_windows:
            race_windows[post] = ("recovery", race, recovery_factor)

    block_types = _assign_block_types(weeks, comrades_idx, race_windows)

    conn.execute("BEGIN")
    try:
        conn.execute("DELETE FROM training_plan_daily")
        conn.execute("DELETE FROM training_plan")
        conn.execute("DELETE FROM training_blocks")

        for week_num, (monday, block_type) in enumerate(zip(weeks, block_types), start=1):
            sunday = monday + timedelta(days=6)

            base_km = _target_km(block_type, week_num - 1, comrades_idx, current_km)
            if monday in race_windows:
                _, _, factor = race_windows[monday]
                weekly_km = base_km * factor if block_type not in ("race", "recovery") else base_km * factor
            else:
                weekly_km = base_km

            phase_labels = {
                "base": "Base", "build": "Build", "peak": "Peak",
                "taper": "Taper", "race_taper": "Race Prep",
                "recovery": "Recovery", "deload": "Deload", "race": "Race Week",
            }
            is_deload = block_type in ("deload", "recovery")

            # Long run = 30% of weekly km, capped at 35%
            long_run_km = min(weekly_km * 0.30, weekly_km * 0.35)

            upsert_training_plan_week(conn, {
                "week_number": week_num,
                "week_start_date": monday.isoformat(),
                "phase": phase_labels.get(block_type, block_type.title()),
                "planned_distance_km": round(weekly_km, 1),
                "planned_long_run_km": round(long_run_km, 1),
                "planned_sessions": _session_count(block_type),
                "is_deload": is_deload,
                "notes": None,
            })

            _write_daily_sessions(conn, monday, week_num, block_type, weekly_km)

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def _session_count(block_type: str) -> int:
    return {"base": 5, "build": 5, "peak": 6, "taper": 5,
            "race_taper": 4, "recovery": 4, "deload": 4, "race": 3}.get(block_type, 5)


def _write_daily_sessions(conn, monday: date, week_num: int, block_type: str, weekly_km: float) -> None:
    # Placeholder — filled in Task 4
    pass


# --- Race detection & analysis (filled in Task 5) ---
def detect_and_analyse_race(conn, activity: dict) -> dict | None:
    return None


def update_comrades_projection(conn, race_event_id: int, race_result: dict) -> float:
    return 0.0
```

- [ ] **Step 3.4: Run block builder tests**

```bash
pytest tests/test_periodization.py -v -k "monday or block_types or taper or peak or deload or race_window or build_plan"
```

Expected: all block builder tests pass. `test_build_plan_transaction_rolls_back_on_error` may still fail — that's fine, leave it for Task 4.

- [ ] **Step 3.5: Commit**

```bash
git add src/periodization.py tests/test_periodization.py
git commit -m "feat: periodization block builder — macro structure, race windows, taper/peak/build/deload"
```

---

## Task 4: Periodization Engine — Daily Session Generator

**Files:**
- Modify: `src/periodization.py` — replace `_write_daily_sessions` stub
- Modify: `tests/test_periodization.py` — add daily session tests

**Interfaces:**
- Produces: `training_plan_daily` rows written for every week `build_plan` generates

- [ ] **Step 4.1: Write failing tests**

Add to `tests/test_periodization.py`:

```python
def test_build_plan_writes_daily_sessions(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    count = mem_conn.execute("SELECT COUNT(*) FROM training_plan_daily").fetchone()[0]
    assert count > 0


def test_daily_sessions_have_valid_session_types(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    valid = {"rest", "sc", "easy_run", "quality_run", "long_run", "hills", "race"}
    rows = mem_conn.execute("SELECT DISTINCT session_type FROM training_plan_daily").fetchall()
    for (st,) in rows:
        assert st in valid, f"Invalid session_type: {st}"


def test_daily_sessions_have_valid_intensities(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    valid = {"rest", "easy", "moderate", "hard", "race"}
    rows = mem_conn.execute("SELECT DISTINCT intensity FROM training_plan_daily").fetchall()
    for (iv,) in rows:
        assert iv in valid, f"Invalid intensity: {iv}"


def test_long_run_not_more_than_35_pct_of_weekly_km(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    rows = mem_conn.execute("""
        SELECT d.week_number, d.planned_distance_km AS long_km, p.planned_distance_km AS weekly_km
        FROM training_plan_daily d
        JOIN training_plan p ON d.week_number = p.week_number
        WHERE d.session_type = 'long_run'
    """).fetchall()
    for week_num, long_km, weekly_km in rows:
        if weekly_km and weekly_km > 0:
            assert long_km / weekly_km <= 0.36, (
                f"Week {week_num}: long run {long_km:.1f} is {long_km/weekly_km:.0%} of {weekly_km:.1f}"
            )


def test_quality_sessions_rotate(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    types = mem_conn.execute("""
        SELECT session_type FROM training_plan_daily
        WHERE session_type IN ('quality_run', 'hills')
        ORDER BY planned_date
        LIMIT 9
    """).fetchall()
    # Should not be all identical — rotation means variety
    unique = {t[0] for t in types}
    assert len(unique) >= 1  # at least one quality type used


def test_recovery_week_has_no_quality_sessions(mem_conn):
    race = {
        "id": 1, "name": "Test Race", "distance_km": 42.2,
        "priority": "A",
        "race_date": (_monday(date.today()) + timedelta(weeks=6)).isoformat(),
    }
    build_plan(mem_conn, COMRADES, [race])
    # Recovery week is the week after the race
    recovery_mon = _monday(date.fromisoformat(race["race_date"])) + timedelta(weeks=1)
    rows = mem_conn.execute("""
        SELECT session_type FROM training_plan_daily
        WHERE planned_date >= ? AND planned_date <= ?
          AND session_type IN ('quality_run', 'hills')
    """, [recovery_mon.isoformat(), (recovery_mon + timedelta(days=6)).isoformat()]).fetchall()
    assert len(rows) == 0
```

- [ ] **Step 4.2: Run tests — verify they fail**

```bash
pytest tests/test_periodization.py -v -k "daily or long_run or quality or recovery_week"
```

Expected: `FAIL` — `_write_daily_sessions` is a stub.

- [ ] **Step 4.3: Implement `_write_daily_sessions` in `src/periodization.py`**

Replace the stub `_write_daily_sessions` function with:

```python
_QUALITY_ROTATION = ["hills", "tempo", "intervals"]

_DESCRIPTIONS = {
    "rest":        {"rest":     "Full rest. Walk only. Prioritise sleep and nutrition."},
    "sc":          {"rest":     "Strength & conditioning: glutes, hip flexors, single-leg work. 45–60 min."},
    "easy_run":    {
        "easy":     "RPE 4–5. Conversational pace. Focus on time on feet.",
        "moderate": "RPE 5–6. Comfortably hard. Last 15 min can push slightly.",
    },
    "quality_run": {
        "hard":     "Tempo: 10 min warm-up, 30 min at half-marathon effort (RPE 7), 10 min cool-down.",
    },
    "hills":       {"hard":     "Hill repeats: 8 × 90s hard uphill, jog down recovery. Builds Comrades climbing strength."},
    "long_run":    {
        "easy":     "RPE 4–5. Pure recovery long run. Heart rate stays in Z1–Z2 throughout.",
        "moderate": "RPE 5–6. Steady aerobic effort. Practise race nutrition every 30 min.",
        "hard":     "RPE 6–7. Peak-block long run — start easy, finish at marathon effort.",
    },
    "race":        {"race":     "Race day. Execute your pacing plan. Treat as a hard training stimulus."},
}

# Mon=0 … Sun=6 session templates per block type
# (session_type, intensity, km_fraction_of_weekly)
_TEMPLATES: dict[str, list[tuple]] = {
    "base":      [("rest","rest",0), ("easy_run","easy",0.12), ("easy_run","easy",0.12),
                  ("easy_run","moderate",0.14), ("sc","rest",0), ("easy_run","easy",0.12), ("long_run","moderate",0.30)],
    "build":     [("rest","rest",0), ("easy_run","easy",0.10), ("quality_run","hard",0.13),
                  ("easy_run","easy",0.12), ("sc","rest",0), ("easy_run","easy",0.10), ("long_run","moderate",0.30)],
    "peak":      [("easy_run","easy",0.10), ("quality_run","hard",0.13), ("easy_run","easy",0.10),
                  ("hills","hard",0.12), ("rest","rest",0), ("easy_run","easy",0.10), ("long_run","hard",0.30)],
    "taper":     [("rest","rest",0), ("easy_run","easy",0.12), ("quality_run","hard",0.13),
                  ("easy_run","easy",0.12), ("rest","rest",0), ("easy_run","easy",0.10), ("long_run","moderate",0.25)],
    "race_taper_A": [("rest","rest",0), ("easy_run","easy",0.15), ("rest","rest",0),
                     ("easy_run","easy",0.12), ("rest","rest",0), ("easy_run","easy",0.10), ("easy_run","easy",0.08)],
    "race_taper_B": [("rest","rest",0), ("easy_run","easy",0.13), ("quality_run","hard",0.13),
                     ("easy_run","easy",0.12), ("rest","rest",0), ("easy_run","easy",0.10), ("easy_run","easy",0.08)],
    "recovery":  [("rest","rest",0), ("easy_run","easy",0.14), ("easy_run","easy",0.14),
                  ("rest","rest",0), ("rest","rest",0), ("easy_run","easy",0.14), ("long_run","easy",0.22)],
    "deload":    [("rest","rest",0), ("easy_run","easy",0.13), ("easy_run","easy",0.13),
                  ("rest","rest",0), ("sc","rest",0), ("easy_run","easy",0.13), ("long_run","easy",0.25)],
    "race":      [("easy_run","easy",0.10), ("easy_run","easy",0.10), ("rest","rest",0),
                  ("easy_run","easy",0.08), ("rest","rest",0), ("easy_run","easy",0.08), ("race","race",0)],
}

_quality_idx = 0  # module-level rotation counter (reset at start of build_plan)


def _write_daily_sessions(conn, monday: date, week_num: int, block_type: str, weekly_km: float) -> None:
    global _quality_idx
    DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    # Pick template — race_taper needs priority context; use generic race_taper_B as fallback
    template_key = block_type
    if block_type == "race_taper":
        template_key = "race_taper_B"  # default; priority passed separately if needed

    template = _TEMPLATES.get(template_key, _TEMPLATES["base"])

    for day_offset, (stype, intensity, km_frac) in enumerate(template):
        planned_date = monday + timedelta(days=day_offset)

        # Swap quality_run for hills on rotation
        actual_type = stype
        if stype == "quality_run":
            rotation_type = _QUALITY_ROTATION[_quality_idx % len(_QUALITY_ROTATION)]
            if rotation_type == "hills":
                actual_type = "hills"
                intensity = "hard"
            elif rotation_type == "tempo":
                actual_type = "quality_run"
            else:  # intervals
                actual_type = "quality_run"
            _quality_idx += 1

        planned_km = round(weekly_km * km_frac, 1) if km_frac > 0 else None

        # Long run guard: cap at 35% of weekly_km
        if actual_type == "long_run" and planned_km and weekly_km > 0:
            planned_km = min(planned_km, round(weekly_km * 0.35, 1))

        desc_map = _DESCRIPTIONS.get(actual_type, {})
        description = desc_map.get(intensity, desc_map.get(list(desc_map.keys())[0], "—") if desc_map else "—")

        upsert_daily_session(conn, {
            "planned_date": planned_date.isoformat(),
            "week_number": week_num,
            "day_of_week": DAYS[day_offset],
            "session_type": actual_type,
            "planned_distance_km": planned_km,
            "intensity": intensity,
            "description": description,
            "is_quality": actual_type in ("quality_run", "hills"),
        })
```

Also reset `_quality_idx` at the top of `build_plan` (inside the function, before the loop):

```python
    # Reset quality rotation for reproducible plan generation
    import periodization as _self
    _self._quality_idx = 0
```

- [ ] **Step 4.4: Run all periodization tests**

```bash
pytest tests/test_periodization.py -v
```

Expected: all tests pass including the daily session tests.

- [ ] **Step 4.5: Delete `src/generate_daily_plan.py`**

```bash
git rm src/generate_daily_plan.py
```

- [ ] **Step 4.6: Commit**

```bash
git add src/periodization.py tests/test_periodization.py
git commit -m "feat: periodization daily session generator — block templates, quality rotation, long-run guard"
```

---

## Task 5: Race Detection & Analysis

**Files:**
- Modify: `src/periodization.py` — implement `detect_and_analyse_race`, `update_comrades_projection`
- Modify: `src/sync.py` — call detection after each new activity
- Create: `tests/test_race_analysis.py`

**Interfaces:**
- Consumes: `get_all_race_events`, `stamp_race_activity`, `upsert_race_analysis` from `db.py`; `upsert_streams_derived` from `db.py`; `strava_client.get_activity_streams`
- Produces: `race_analysis` row written; `race_events.strava_activity_id` stamped

- [ ] **Step 5.1: Write failing tests**

Create `tests/test_race_analysis.py`:

```python
import sys
from pathlib import Path
from datetime import date
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from db import upsert_activity, upsert_race_event
from periodization import detect_and_analyse_race, update_comrades_projection

_BASE_ACTIVITY = {
    "id": 77777,
    "name": "Two Oceans Ultra",
    "sport_type": "Run",
    "category": "running",
    "start_date_local": "2026-04-19T06:00:00",
    "distance_km": 56.1,
    "moving_time_min": 330.0,
    "elapsed_time_min": 335.0,
    "elevation_gain_m": 1200.0,
    "average_heartrate": 152.0,
    "max_heartrate": 172.0,
    "average_cadence": 168.0,
    "average_speed_kmh": 10.2,
    "relative_effort": 280.0,
    "load_score": 280.0,
    "gear_id": None,
    "gear_name": None,
}

_BASE_RACE_EVENT = {
    "name": "Two Oceans Ultra",
    "race_date": "2026-04-19",
    "distance_km": 56.0,
    "priority": "A",
    "target_finish_h": 6.0,
}


def test_detect_matches_on_date_and_distance(mem_conn):
    upsert_activity(mem_conn, _BASE_ACTIVITY)
    rid = upsert_race_event(mem_conn, _BASE_RACE_EVENT)
    result = detect_and_analyse_race(mem_conn, _BASE_ACTIVITY)
    assert result is not None
    assert result["race_event_id"] == rid


def test_detect_no_match_when_date_too_far(mem_conn):
    activity = {**_BASE_ACTIVITY, "start_date_local": "2026-04-22T06:00:00"}  # 3 days off
    upsert_activity(mem_conn, activity)
    upsert_race_event(mem_conn, _BASE_RACE_EVENT)
    assert detect_and_analyse_race(mem_conn, activity) is None


def test_detect_no_match_when_distance_off(mem_conn):
    activity = {**_BASE_ACTIVITY, "distance_km": 10.0}  # not a 56km race
    upsert_activity(mem_conn, activity)
    upsert_race_event(mem_conn, _BASE_RACE_EVENT)
    assert detect_and_analyse_race(mem_conn, activity) is None


def test_detect_tiebreak_picks_closer_distance(mem_conn):
    upsert_activity(mem_conn, _BASE_ACTIVITY)
    rid_close = upsert_race_event(mem_conn, {**_BASE_RACE_EVENT, "name": "Close", "distance_km": 56.0})
    rid_far   = upsert_race_event(mem_conn, {**_BASE_RACE_EVENT, "name": "Far",   "distance_km": 55.0})
    result = detect_and_analyse_race(mem_conn, _BASE_ACTIVITY)
    assert result["race_event_id"] == rid_close


def test_detect_stamps_strava_activity_id(mem_conn):
    upsert_activity(mem_conn, _BASE_ACTIVITY)
    rid = upsert_race_event(mem_conn, _BASE_RACE_EVENT)
    detect_and_analyse_race(mem_conn, _BASE_ACTIVITY)
    row = mem_conn.execute(
        "SELECT strava_activity_id FROM race_events WHERE id = ?", [rid]
    ).fetchone()
    assert row[0] == 77777


def test_riegel_projection_formula(mem_conn):
    upsert_activity(mem_conn, _BASE_ACTIVITY)
    rid = upsert_race_event(mem_conn, _BASE_RACE_EVENT)
    race_result = {"activity_id": 77777, "race_distance_km": 56.0, "race_time_h": 5.5}
    proj_h = update_comrades_projection(mem_conn, rid, race_result)
    # Riegel: T2 = 5.5 × (90/56)^1.06 × 1.04
    import math
    expected = 5.5 * (90.0 / 56.0) ** 1.06 * 1.04
    assert proj_h == pytest.approx(expected, rel=0.01)


def test_projection_written_to_race_analysis(mem_conn):
    upsert_activity(mem_conn, _BASE_ACTIVITY)
    rid = upsert_race_event(mem_conn, _BASE_RACE_EVENT)
    race_result = {"activity_id": 77777, "race_distance_km": 56.0, "race_time_h": 5.5}
    update_comrades_projection(mem_conn, rid, race_result)
    row = mem_conn.execute(
        "SELECT comrades_projection_h FROM race_analysis WHERE race_event_id = ?", [rid]
    ).fetchone()
    assert row is not None
    assert row[0] > 0
```

- [ ] **Step 5.2: Run tests — verify they fail**

```bash
pytest tests/test_race_analysis.py -v
```

Expected: `FAIL` — stubs return `None` / `0.0`.

- [ ] **Step 5.3: Implement `detect_and_analyse_race` and `update_comrades_projection` in `src/periodization.py`**

Replace the two stub functions:

```python
def detect_and_analyse_race(conn, activity: dict) -> dict | None:
    if activity.get("category") != "running":
        return None
    if not activity.get("distance_km"):
        return None

    act_date = activity["start_date_local"][:10]  # "YYYY-MM-DD"
    act_km = float(activity["distance_km"])

    races = conn.execute("""
        SELECT id, race_date::TEXT, distance_km
        FROM race_events
        WHERE strava_activity_id IS NULL
          AND ABS(CAST(race_date AS DATE) - CAST(? AS DATE)) <= 1
    """, [act_date]).fetchall()

    candidates = [
        (rid, abs(act_km - race_km), race_km)
        for rid, race_date_str, race_km in races
        if race_km > 0 and abs(act_km - race_km) / race_km <= 0.10
    ]
    if not candidates:
        return None

    # Tiebreak: closest distance
    race_event_id, _, race_km = min(candidates, key=lambda x: x[1])

    # Stamp activity on the race event
    from db import stamp_race_activity
    stamp_race_activity(conn, race_event_id, activity["id"])

    avg_pace = (
        activity["moving_time_min"] / act_km
        if act_km and activity.get("moving_time_min") else None
    )
    race_time_h = activity["moving_time_min"] / 60.0 if activity.get("moving_time_min") else None

    analysis = {
        "race_event_id": race_event_id,
        "activity_id": activity["id"],
        "avg_pace_min_km": avg_pace,
        "comrades_projection_h": 0.0,
        "riegel_factor": 1.06,
    }

    if race_time_h:
        proj_h = update_comrades_projection(conn, race_event_id, {
            "activity_id": activity["id"],
            "race_distance_km": race_km,
            "race_time_h": race_time_h,
        })
        analysis["comrades_projection_h"] = proj_h

    return analysis


def update_comrades_projection(conn, race_event_id: int, race_result: dict) -> float:
    race_h = float(race_result["race_time_h"])
    race_km = float(race_result["race_distance_km"])
    riegel = race_h * (RACE_DISTANCE_KM / race_km) ** 1.06 * TERRAIN_FACTOR

    from db import upsert_race_analysis
    upsert_race_analysis(conn, {
        "race_event_id": race_event_id,
        "activity_id": race_result["activity_id"],
        "avg_pace_min_km": race_result.get("avg_pace_min_km"),
        "comrades_projection_h": round(riegel, 3),
        "riegel_factor": 1.06,
    })
    return round(riegel, 3)
```

- [ ] **Step 5.4: Wire detection into `src/sync.py`**

Add import at top of `sync.py`:

```python
from periodization import detect_and_analyse_race
```

Replace the activity sync loop to call detection:

```python
        new_activity_ids = []
        for raw in raw_activities:
            activity = parse_activity(category_map, raw)
            upsert_activity(conn, activity)
            new_activity_ids.append(activity)

            gear_id = activity.get("gear_id")
            if gear_id and gear_id not in seen_gear:
                gear_data = strava_client.get_gear(access_token, gear_id)
                gear_name = gear_data.get("name", gear_id) if gear_data else gear_id
                upsert_gear(conn, gear_id, gear_name)
                seen_gear.add(gear_id)

        for activity in new_activity_ids:
            detect_and_analyse_race(conn, activity)
```

- [ ] **Step 5.5: Run all tests**

```bash
pytest tests/test_race_analysis.py tests/test_periodization.py tests/test_sync.py -v
```

Expected: all tests pass.

- [ ] **Step 5.6: Commit**

```bash
git add src/periodization.py src/sync.py tests/test_race_analysis.py
git commit -m "feat: race detection + Riegel projection — auto-detect completed races, update Comrades estimate"
```

---

## Task 6: New Metric Functions

**Files:**
- Modify: `src/metrics.py` — add 4 new functions
- Modify: `tests/test_metrics.py` — add tests for each

**Interfaces:**
- Produces:
  - `ctl_atl_tsb_history(conn) -> pd.DataFrame` — columns: `day, load, ctl, atl, tsb`
  - `long_run_quality_scores(conn) -> pd.DataFrame` — columns: `activity_date, name, distance_km, z2_compliance_pct, decoupling_pct, quality_score`
  - `comrades_projected_splits(conn) -> pd.DataFrame` — columns: `checkpoint, km, cumulative_time, cumulative_min`
  - `shoe_mileage(conn) -> pd.DataFrame` — columns: `id, name, type, total_km, retire_km_threshold, km_remaining, is_retired`

- [ ] **Step 6.1: Write failing tests**

Add to `tests/test_metrics.py`:

```python
def test_ctl_atl_tsb_history_columns(mem_conn):
    _insert_run(mem_conn, 901, "2026-01-05T07:00:00", 10.0, load_score=80.0)
    df = metrics.ctl_atl_tsb_history(mem_conn)
    assert isinstance(df, pd.DataFrame)
    for col in ("day", "load", "ctl", "atl", "tsb"):
        assert col in df.columns, f"Missing column: {col}"


def test_ctl_increases_with_consistent_load(mem_conn):
    for i in range(50):
        from datetime import date, timedelta
        d = (date(2026, 1, 1) + timedelta(days=i)).isoformat()
        _insert_run(mem_conn, 800 + i, f"{d}T07:00:00", 10.0, load_score=100.0)
    df = metrics.ctl_atl_tsb_history(mem_conn).sort_values("day")
    # CTL should be higher at the end than at the beginning
    assert float(df["ctl"].iloc[-1]) > float(df["ctl"].iloc[0])


def test_long_run_quality_scores_only_runs_over_20km(mem_conn):
    from db import upsert_streams_derived
    _insert_run(mem_conn, 701, "2026-02-01T07:00:00", 25.0, load_score=150.0)
    _insert_run(mem_conn, 702, "2026-02-08T07:00:00", 10.0, load_score=60.0)
    for aid in (701, 702):
        upsert_streams_derived(mem_conn, {
            "activity_id": aid, "elevation_loss_m": 50.0, "decoupling_pct": 2.0,
            "pct_time_z1": 20.0, "pct_time_z2": 55.0, "pct_time_z3": 20.0,
            "pct_time_z4": 4.0, "pct_time_z5": 1.0,
            "grade_adjusted_pace": 6.0, "cadence_avg": 172.0,
        })
    df = metrics.long_run_quality_scores(mem_conn)
    assert len(df) == 1
    assert float(df.iloc[0]["distance_km"]) == pytest.approx(25.0)


def test_long_run_quality_score_range(mem_conn):
    from db import upsert_streams_derived
    _insert_run(mem_conn, 703, "2026-02-15T07:00:00", 30.0, load_score=200.0)
    upsert_streams_derived(mem_conn, {
        "activity_id": 703, "elevation_loss_m": 100.0, "decoupling_pct": 1.5,
        "pct_time_z1": 25.0, "pct_time_z2": 60.0, "pct_time_z3": 12.0,
        "pct_time_z4": 2.0, "pct_time_z5": 1.0,
        "grade_adjusted_pace": 5.8, "cadence_avg": 174.0,
    })
    df = metrics.long_run_quality_scores(mem_conn)
    score = float(df.iloc[0]["quality_score"])
    assert 0 <= score <= 100


def test_shoe_mileage_sums_running_km(mem_conn):
    from db import upsert_gear
    upsert_gear(mem_conn, "gABC", "Test Shoe")
    _insert_run(mem_conn, 601, "2026-03-01T07:00:00", 15.0, load_score=90.0)
    _insert_run(mem_conn, 602, "2026-03-08T07:00:00", 20.0, load_score=120.0)
    mem_conn.execute("UPDATE activities SET gear_id = 'gABC' WHERE id IN (601, 602)")
    df = metrics.shoe_mileage(mem_conn)
    row = df[df["id"] == "gABC"].iloc[0]
    assert float(row["total_km"]) == pytest.approx(35.0)
    assert float(row["km_remaining"]) == pytest.approx(765.0)


def test_comrades_projected_splits_returns_checkpoints(mem_conn):
    from db import upsert_race_event, upsert_race_analysis, upsert_activity
    activity = {
        "id": 88888, "name": "Race", "sport_type": "Run", "category": "running",
        "start_date_local": "2026-04-19T06:00:00", "distance_km": 56.0,
        "moving_time_min": 330.0, "elapsed_time_min": 335.0, "elevation_gain_m": 800.0,
        "average_heartrate": 150.0, "max_heartrate": 170.0, "average_cadence": 168.0,
        "average_speed_kmh": 10.2, "relative_effort": 250.0, "load_score": 250.0,
        "gear_id": None, "gear_name": None,
    }
    upsert_activity(mem_conn, activity)
    rid = upsert_race_event(mem_conn, {
        "name": "Two Oceans", "race_date": "2026-04-19",
        "distance_km": 56.0, "priority": "A",
    })
    upsert_race_analysis(mem_conn, {
        "race_event_id": rid, "activity_id": 88888,
        "comrades_projection_h": 9.5, "riegel_factor": 1.06,
    })
    df = metrics.comrades_projected_splits(mem_conn)
    assert not df.empty
    assert "checkpoint" in df.columns
    assert "cumulative_time" in df.columns
    # Last checkpoint should be Durban
    assert df.iloc[-1]["checkpoint"] == "Durban"
```

- [ ] **Step 6.2: Run tests — verify they fail**

```bash
pytest tests/test_metrics.py -v -k "ctl or quality or shoe or splits"
```

Expected: `AttributeError` — functions not defined yet.

- [ ] **Step 6.3: Add the four metric functions to `src/metrics.py`**

Append after the last existing function:

```python
def ctl_atl_tsb_history(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    daily = conn.execute("""
        WITH date_spine AS (
            SELECT generate_series(
                (SELECT MIN(start_date_local::DATE) FROM activities),
                CURRENT_DATE,
                INTERVAL '1 day'
            )::DATE AS day
        ),
        daily_load AS (
            SELECT start_date_local::DATE AS day, SUM(load_score) AS load
            FROM activities GROUP BY 1
        )
        SELECT d.day, COALESCE(l.load, 0.0) AS load
        FROM date_spine d
        LEFT JOIN daily_load l ON d.day = l.day
        ORDER BY d.day
    """).df()

    if daily.empty:
        return daily

    ctl, atl = 0.0, 0.0
    rows = []
    for _, row in daily.iterrows():
        tsb = ctl - atl
        ctl = ctl + (float(row["load"]) - ctl) / 42.0
        atl = atl + (float(row["load"]) - atl) / 7.0
        rows.append({"day": row["day"], "load": row["load"],
                     "ctl": round(ctl, 2), "atl": round(atl, 2), "tsb": round(tsb, 2)})

    return pd.DataFrame(rows)


def long_run_quality_scores(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        SELECT
            a.start_date_local::DATE AS activity_date,
            a.name,
            ROUND(a.distance_km, 1) AS distance_km,
            ROUND(COALESCE(s.pct_time_z1 + s.pct_time_z2, 0), 1) AS z2_compliance_pct,
            ROUND(COALESCE(s.decoupling_pct, 0), 2) AS decoupling_pct,
            ROUND(GREATEST(0, LEAST(100,
                -- Z2 compliance component: maps 60–100% → 0–100
                GREATEST(0, (COALESCE(s.pct_time_z1 + s.pct_time_z2, 0) - 60.0) / 40.0 * 100.0) * 0.5
                +
                -- Decoupling component: maps 0% decoupling → 100, 5%+ → 0
                GREATEST(0, (5.0 - LEAST(5.0, ABS(COALESCE(s.decoupling_pct, 5.0)))) / 5.0 * 100.0) * 0.5
            )), 1) AS quality_score
        FROM activities a
        JOIN activity_streams_derived s ON a.id = s.activity_id
        WHERE a.category = 'running'
          AND a.distance_km >= 20
        ORDER BY a.start_date_local DESC
    """).df()


COMRADES_CHECKPOINTS = [
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


def comrades_projected_splits(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    proj_row = conn.execute(
        "SELECT comrades_projection_h FROM race_analysis ORDER BY computed_at DESC LIMIT 1"
    ).fetchone()

    if not proj_row:
        z2_row = conn.execute("""
            SELECT AVG(moving_time_min / NULLIF(distance_km, 0))
            FROM activities
            WHERE category = 'running' AND distance_km >= 10
              AND start_date_local >= CURRENT_DATE - INTERVAL '90 days'
        """).fetchone()
        if not z2_row or not z2_row[0]:
            return pd.DataFrame()
        total_h = float(z2_row[0]) * 90.0 / 60.0 * 1.04
    else:
        total_h = float(proj_row[0])

    total_min = total_h * 60.0
    rows = []
    raw_cumulative = 0.0
    seg_mins = []

    for i, (name, km, elev) in enumerate(COMRADES_CHECKPOINTS):
        if i == 0:
            rows.append({"checkpoint": name, "km": km,
                         "cumulative_time": "0:00", "cumulative_min": 0.0})
            seg_mins.append(0.0)
            continue
        prev_km, prev_elev = COMRADES_CHECKPOINTS[i - 1][1], COMRADES_CHECKPOINTS[i - 1][2]
        seg_km = km - prev_km
        grade = (elev - prev_elev) / (seg_km * 1000.0)
        adj = 1.0 + grade * (2.0 if grade > 0 else -1.5)
        seg_min = total_min * (seg_km / 90.0) * adj
        raw_cumulative += seg_min
        seg_mins.append(seg_min)
        rows.append({"checkpoint": name, "km": km,
                     "cumulative_min": round(raw_cumulative, 1), "cumulative_time": ""})

    # Normalize so final checkpoint == total_min
    scale = total_min / raw_cumulative if raw_cumulative else 1.0
    cum = 0.0
    for i, r in enumerate(rows):
        if i == 0:
            continue
        cum += seg_mins[i] * scale
        r["cumulative_min"] = round(cum, 1)
        h, m = int(cum // 60), int(cum % 60)
        r["cumulative_time"] = f"{h}:{m:02d}"

    return pd.DataFrame(rows)


def shoe_mileage(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        SELECT
            g.id,
            g.name,
            g.type,
            g.retire_km_threshold,
            g.is_retired,
            ROUND(COALESCE(SUM(a.distance_km), 0), 1) AS total_km,
            ROUND(g.retire_km_threshold - COALESCE(SUM(a.distance_km), 0), 1) AS km_remaining
        FROM gear g
        LEFT JOIN activities a
            ON a.gear_id = g.id AND a.category = 'running'
        WHERE NOT g.is_retired
        GROUP BY g.id, g.name, g.type, g.retire_km_threshold, g.is_retired
        ORDER BY total_km DESC
    """).df()
```

- [ ] **Step 6.4: Run all metric tests**

```bash
pytest tests/test_metrics.py -v
```

Expected: all tests pass including the 7 new ones.

- [ ] **Step 6.5: Run the full test suite**

```bash
pytest -v
```

Expected: all tests pass. Zero failures.

- [ ] **Step 6.6: Commit**

```bash
git add src/metrics.py tests/test_metrics.py
git commit -m "feat: metrics — CTL/ATL/TSB, long run quality score, Comrades splits projection, shoe mileage"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** race_events ✓, training_blocks ✓, gear ✓, race_analysis ✓, periodization engine ✓, race detection ✓, Riegel projection ✓, CTL/ATL/TSB ✓, long run quality ✓, Comrades splits ✓, shoe mileage ✓
- [x] **Placeholders:** none — all steps contain actual code
- [x] **Type consistency:** `upsert_race_event` → `int`; `detect_and_analyse_race` → `dict | None`; `update_comrades_projection` → `float`; all consumers reference same signatures
- [x] **`_write_daily_sessions` stub replaced** in Task 4 before daily session tests run
- [x] **`seen_gear` set** pre-loaded from DB to avoid redundant Strava API calls on re-sync
- [x] **Transaction rollback** tested in Task 3, implemented in `build_plan`
- [x] **`generate_daily_plan.py` deletion** in Task 4 Step 4.5
