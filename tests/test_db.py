# tests/test_db.py
import duckdb
import pytest
import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from db import init_schema, upsert_activity, upsert_streams_derived, get_last_synced, set_last_synced


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
