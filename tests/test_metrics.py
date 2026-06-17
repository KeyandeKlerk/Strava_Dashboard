# tests/test_metrics.py
import sys
from pathlib import Path
import pytest
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from db import upsert_activity
import metrics


def _insert_run(conn, activity_id, date_str, distance_km, moving_time_min=60.0, elevation=100.0, load_score=60.0):
    upsert_activity(conn, {
        "id": activity_id,
        "name": "Run",
        "sport_type": "Run",
        "category": "running",
        "start_date_local": date_str,
        "distance_km": distance_km,
        "moving_time_min": moving_time_min,
        "elapsed_time_min": moving_time_min + 2,
        "elevation_gain_m": elevation,
        "average_heartrate": 145.0,
        "max_heartrate": 160.0,
        "average_cadence": 172.0,
        "average_speed_kmh": distance_km / (moving_time_min / 60),
        "relative_effort": load_score,
        "load_score": load_score,
    })


def _insert_gym(conn, activity_id, date_str, moving_time_min=60.0):
    upsert_activity(conn, {
        "id": activity_id,
        "name": "Gym",
        "sport_type": "WeightTraining",
        "category": "gym",
        "start_date_local": date_str,
        "distance_km": None,
        "moving_time_min": moving_time_min,
        "elapsed_time_min": moving_time_min + 5,
        "elevation_gain_m": 0.0,
        "average_heartrate": None,
        "max_heartrate": None,
        "average_cadence": None,
        "average_speed_kmh": None,
        "relative_effort": None,
        "load_score": moving_time_min,
    })


def test_weekly_volume_returns_dataframe(mem_conn):
    _insert_run(mem_conn, 1, "2024-03-11T07:00:00", 10.0)
    _insert_run(mem_conn, 2, "2024-03-13T07:00:00", 15.0)
    df = metrics.weekly_volume(mem_conn)
    assert isinstance(df, pd.DataFrame)
    assert "run_distance_km" in df.columns


def test_weekly_volume_sums_by_week(mem_conn):
    _insert_run(mem_conn, 1, "2024-03-11T07:00:00", 10.0)  # Mon
    _insert_run(mem_conn, 2, "2024-03-13T07:00:00", 15.0)  # Wed
    _insert_run(mem_conn, 3, "2024-03-18T07:00:00", 12.0)  # following Mon
    df = metrics.weekly_volume(mem_conn)
    assert len(df) == 2
    row = df[(df["run_distance_km"] - 25.0).abs() < 1e-6]
    assert len(row) == 1


def test_weekly_volume_longest_run(mem_conn):
    _insert_run(mem_conn, 1, "2024-03-11T07:00:00", 10.0)
    _insert_run(mem_conn, 2, "2024-03-13T07:00:00", 22.0)
    df = metrics.weekly_volume(mem_conn)
    assert df.iloc[0]["longest_run_km"] == pytest.approx(22.0)


def test_weekly_volume_excludes_gym_from_distance(mem_conn):
    _insert_run(mem_conn, 1, "2024-03-11T07:00:00", 10.0)
    _insert_gym(mem_conn, 2, "2024-03-12T08:00:00", 60.0)
    df = metrics.weekly_volume(mem_conn)
    assert df.iloc[0]["run_distance_km"] == pytest.approx(10.0)


def test_weekly_volume_total_time_includes_all_categories(mem_conn):
    _insert_run(mem_conn, 1, "2024-03-11T07:00:00", 10.0, moving_time_min=60.0)
    _insert_gym(mem_conn, 2, "2024-03-12T08:00:00", 60.0)
    df = metrics.weekly_volume(mem_conn)
    assert df.iloc[0]["total_time_min"] == pytest.approx(120.0)


def test_weekly_category_load_splits_categories(mem_conn):
    _insert_run(mem_conn, 1, "2024-03-11T07:00:00", 10.0, load_score=80.0)
    _insert_gym(mem_conn, 2, "2024-03-12T08:00:00", 60.0)
    df = metrics.weekly_category_load(mem_conn)
    row = df.iloc[0]
    assert row["running_load"] == pytest.approx(80.0)
    assert row["gym_load"] == pytest.approx(60.0)


def test_recent_activities_returns_n_rows(mem_conn):
    for i in range(15):
        _insert_run(mem_conn, i, f"2024-03-{i+1:02d}T07:00:00", float(i + 5))
    df = metrics.recent_activities(mem_conn, n=10)
    assert len(df) == 10
