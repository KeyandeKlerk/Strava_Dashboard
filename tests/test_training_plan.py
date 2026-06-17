import sys
from pathlib import Path
import pytest
from datetime import date

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from db import upsert_training_plan_week, upsert_activity
import metrics


WEEK1 = {
    "week_number": 1,
    "week_start_date": date(2026, 9, 14),
    "phase": "base",
    "planned_distance_km": 50.0,
    "planned_long_run_km": 18.0,
    "planned_sessions": 5,
    "is_deload": False,
    "notes": "First week — easy base building",
}

WEEK2 = {
    "week_number": 2,
    "week_start_date": date(2026, 9, 21),
    "phase": "base",
    "planned_distance_km": 55.0,
    "planned_long_run_km": 20.0,
    "planned_sessions": 5,
    "is_deload": False,
    "notes": "",
}


def test_upsert_training_plan_inserts(mem_conn):
    upsert_training_plan_week(mem_conn, WEEK1)
    row = mem_conn.execute("SELECT planned_distance_km FROM training_plan WHERE week_number = 1").fetchone()
    assert row[0] == pytest.approx(50.0)


def test_upsert_training_plan_updates(mem_conn):
    upsert_training_plan_week(mem_conn, WEEK1)
    updated = {**WEEK1, "planned_distance_km": 55.0, "notes": "Updated"}
    upsert_training_plan_week(mem_conn, updated)
    rows = mem_conn.execute("SELECT planned_distance_km FROM training_plan WHERE week_number = 1").fetchall()
    assert len(rows) == 1
    assert rows[0][0] == pytest.approx(55.0)


def test_plan_adherence_joins_correctly(mem_conn):
    upsert_training_plan_week(mem_conn, WEEK1)
    upsert_activity(mem_conn, {
        "id": 999, "name": "Run", "sport_type": "Run", "category": "running",
        "start_date_local": "2026-09-16T07:00:00",
        "distance_km": 45.0, "moving_time_min": 240.0, "elapsed_time_min": 245.0,
        "elevation_gain_m": 200.0, "average_heartrate": 145.0, "max_heartrate": 160.0,
        "average_cadence": 172.0, "average_speed_kmh": 11.25,
        "relative_effort": 80.0, "load_score": 80.0,
    })
    df = metrics.plan_adherence(mem_conn)
    assert len(df) >= 1
    row = df[df["week_number"] == 1].iloc[0]
    assert row["actual_distance_km"] == pytest.approx(45.0)
    assert row["adherence_pct"] == pytest.approx(90.0)
