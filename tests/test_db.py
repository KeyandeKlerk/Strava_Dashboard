# tests/test_db.py
import duckdb
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from db import init_schema, upsert_activity, upsert_streams_derived, get_last_synced, set_last_synced, get_refresh_token, set_refresh_token


SAMPLE_ACTIVITY = {
    "id": 1001,
    "name": "Morning Run",
    "sport_type": "Run",
    "category": "running",
    "start_date_local": "2024-03-15T07:30:00",
    "distance_km": 12.5,
    "moving_time_min": 65.0,
    "elapsed_time_min": 68.0,
    "elevation_gain_m": 145.0,
    "average_heartrate": 148.0,
    "max_heartrate": 168.0,
    "average_cadence": 172.0,
    "average_speed_kmh": 11.5,
    "relative_effort": 95.0,
    "load_score": 95.0,
}


def test_init_schema_creates_all_tables():
    conn = duckdb.connect(":memory:")
    init_schema(conn)
    tables = {t[0] for t in conn.execute("SHOW TABLES").fetchall()}
    assert "activities" in tables
    assert "activity_streams_derived" in tables
    assert "training_plan" in tables
    assert "sync_state" in tables


def test_init_schema_is_idempotent():
    conn = duckdb.connect(":memory:")
    init_schema(conn)
    init_schema(conn)  # second call must not raise


def test_upsert_activity_inserts(mem_conn):
    upsert_activity(mem_conn, SAMPLE_ACTIVITY)
    row = mem_conn.execute("SELECT id, name, distance_km FROM activities WHERE id = 1001").fetchone()
    assert row[0] == 1001
    assert row[1] == "Morning Run"
    assert row[2] == pytest.approx(12.5)


def test_upsert_activity_updates_on_conflict(mem_conn):
    upsert_activity(mem_conn, SAMPLE_ACTIVITY)
    updated = {**SAMPLE_ACTIVITY, "name": "Renamed Run", "distance_km": 13.0}
    upsert_activity(mem_conn, updated)
    rows = mem_conn.execute("SELECT name, distance_km FROM activities WHERE id = 1001").fetchall()
    assert len(rows) == 1
    assert rows[0][0] == "Renamed Run"
    assert rows[0][1] == pytest.approx(13.0)


def test_upsert_activity_accepts_none_distance(mem_conn):
    gym = {**SAMPLE_ACTIVITY, "id": 2002, "category": "gym", "distance_km": None}
    upsert_activity(mem_conn, gym)
    row = mem_conn.execute("SELECT distance_km FROM activities WHERE id = 2002").fetchone()
    assert row[0] is None


def test_sync_state_roundtrip(mem_conn):
    assert get_last_synced(mem_conn) is None
    set_last_synced(mem_conn, 1710500000)
    assert get_last_synced(mem_conn) == 1710500000
    set_last_synced(mem_conn, 1720000000)
    assert get_last_synced(mem_conn) == 1720000000


def test_upsert_streams_derived(mem_conn):
    upsert_activity(mem_conn, SAMPLE_ACTIVITY)
    derived = {
        "activity_id": 1001,
        "elevation_loss_m": 88.5,
        "decoupling_pct": -1.2,
        "pct_time_z1": 5.0,
        "pct_time_z2": 55.0,
        "pct_time_z3": 30.0,
        "pct_time_z4": 8.0,
        "pct_time_z5": 2.0,
        "grade_adjusted_pace": 5.8,
        "cadence_avg": 172.5,
    }
    upsert_streams_derived(mem_conn, derived)
    row = mem_conn.execute(
        "SELECT elevation_loss_m, pct_time_z2 FROM activity_streams_derived WHERE activity_id = 1001"
    ).fetchone()
    assert row[0] == pytest.approx(88.5)
    assert row[1] == pytest.approx(55.0)


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
    # Call again with updated projection — must overwrite, not insert a duplicate
    upsert_race_analysis(mem_conn, {
        "race_event_id": rid, "activity_id": 9999,
        "avg_pace_min_km": 6.0, "comrades_projection_h": 9.5, "riegel_factor": 1.07,
    })
    rows = mem_conn.execute(
        "SELECT comrades_projection_h FROM race_analysis WHERE race_event_id = ?", [rid]
    ).fetchall()
    assert len(rows) == 1
    assert rows[0][0] == pytest.approx(9.5)


def test_upsert_daily_session_inserts_and_updates(mem_conn):
    from db import upsert_daily_session
    session = {
        "planned_date": "2026-09-14",
        "week_number": 1,
        "day_of_week": "Monday",
        "session_type": "easy_run",
        "planned_distance_km": 10.0,
        "intensity": "easy",
        "description": "Recovery jog",
        "is_quality": False,
    }
    upsert_daily_session(mem_conn, session)
    row = mem_conn.execute(
        "SELECT session_type, planned_distance_km FROM training_plan_daily WHERE planned_date = '2026-09-14'"
    ).fetchone()
    assert row[0] == "easy_run"
    assert row[1] == pytest.approx(10.0)
    # Update same date — must overwrite
    upsert_daily_session(mem_conn, {**session, "planned_distance_km": 12.0, "description": "Easy with strides"})
    rows = mem_conn.execute(
        "SELECT planned_distance_km FROM training_plan_daily WHERE planned_date = '2026-09-14'"
    ).fetchall()
    assert len(rows) == 1
    assert rows[0][0] == pytest.approx(12.0)


def test_correlate_activities_to_plan(mem_conn):
    from db import upsert_daily_session, correlate_activities_to_plan
    # Plant a planned run session
    upsert_daily_session(mem_conn, {
        "planned_date": "2026-09-15",
        "week_number": 1,
        "day_of_week": "Tuesday",
        "session_type": "easy_run",
        "planned_distance_km": 10.0,
        "intensity": "easy",
        "description": "Easy run",
    })
    # Plant a planned S&C session
    upsert_daily_session(mem_conn, {
        "planned_date": "2026-09-16",
        "week_number": 1,
        "day_of_week": "Wednesday",
        "session_type": "sc",
        "planned_distance_km": None,
        "intensity": "moderate",
        "description": "Gym",
    })
    # Insert matching activities
    upsert_activity(mem_conn, {
        "id": 5001, "name": "Easy run", "sport_type": "Run", "category": "running",
        "start_date_local": "2026-09-15T07:00:00", "distance_km": 10.5,
        "moving_time_min": 60.0, "elapsed_time_min": 62.0, "elevation_gain_m": 50.0,
        "average_heartrate": 140.0, "max_heartrate": 155.0, "average_cadence": 172.0,
        "average_speed_kmh": 10.5, "relative_effort": 60.0, "load_score": 60.0,
    })
    upsert_activity(mem_conn, {
        "id": 5002, "name": "Gym", "sport_type": "WeightTraining", "category": "gym",
        "start_date_local": "2026-09-16T09:00:00", "distance_km": None,
        "moving_time_min": 45.0, "elapsed_time_min": 50.0, "elevation_gain_m": None,
        "average_heartrate": None, "max_heartrate": None, "average_cadence": None,
        "average_speed_kmh": None, "relative_effort": None, "load_score": None,
    })
    completed = correlate_activities_to_plan(mem_conn)
    assert completed == 2
    run_row = mem_conn.execute(
        "SELECT completed, completed_activity_id, completed_distance_km FROM training_plan_daily WHERE planned_date = '2026-09-15'"
    ).fetchone()
    assert run_row[0] is True
    assert run_row[1] == 5001
    assert run_row[2] == pytest.approx(10.5)
    gym_row = mem_conn.execute(
        "SELECT completed, completed_activity_id FROM training_plan_daily WHERE planned_date = '2026-09-16'"
    ).fetchone()
    assert gym_row[0] is True
    assert gym_row[1] == 5002


def test_get_refresh_token_returns_none_when_unset(mem_conn):
    assert get_refresh_token(mem_conn) is None


def test_set_and_get_refresh_token(mem_conn):
    set_refresh_token(mem_conn, "my_refresh_token")
    assert get_refresh_token(mem_conn) == "my_refresh_token"


def test_set_refresh_token_overwrites_existing(mem_conn):
    set_refresh_token(mem_conn, "old_token")
    set_refresh_token(mem_conn, "new_token")
    assert get_refresh_token(mem_conn) == "new_token"
