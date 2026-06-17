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


def test_acwr_history_shape(mem_conn):
    for i, (d, km, load) in enumerate([
        ("2024-03-04T07:00:00", 10.0, 80.0),
        ("2024-03-06T07:00:00", 8.0,  65.0),
        ("2024-03-08T07:00:00", 6.0,  50.0),
        ("2024-03-11T07:00:00", 12.0, 90.0),
        ("2024-03-13T07:00:00", 10.0, 75.0),
    ]):
        _insert_run(mem_conn, i + 100, d, km, load_score=load)

    df = metrics.acwr_history(mem_conn)
    assert isinstance(df, pd.DataFrame)
    assert "acwr" in df.columns
    assert "load_7d" in df.columns


def test_acwr_is_computable_with_minimal_data(mem_conn):
    _insert_run(mem_conn, 1, "2024-03-11T07:00:00", 10.0, load_score=80.0)
    df = metrics.acwr_history(mem_conn)
    assert len(df) >= 1


def test_weekly_ramp_rate_returns_pct(mem_conn):
    _insert_run(mem_conn, 1, "2024-03-04T07:00:00", 40.0, load_score=40.0)  # week 1
    _insert_run(mem_conn, 2, "2024-03-11T07:00:00", 44.0, load_score=44.0)  # week 2 (+10%)
    df = metrics.weekly_ramp_rate(mem_conn)
    latest = df.iloc[0]
    assert latest["ramp_pct"] == pytest.approx(10.0, rel=0.01)


def test_weekly_monotony_computes(mem_conn):
    # 5 sessions same week, varied load — checks monotony computes without error
    for i, (d, load) in enumerate(zip(
        ["2024-03-11", "2024-03-12", "2024-03-13", "2024-03-14", "2024-03-15"],
        [70.0, 40.0, 80.0, 50.0, 60.0],
    )):
        _insert_run(mem_conn, i + 200, f"{d}T07:00:00", 10.0, load_score=load)
    df = metrics.weekly_monotony(mem_conn)
    assert isinstance(df, pd.DataFrame)
    assert "monotony" in df.columns


def test_long_run_pct_of_weekly_volume(mem_conn):
    _insert_run(mem_conn, 1, "2024-03-11T07:00:00", 10.0)
    _insert_run(mem_conn, 2, "2024-03-13T07:00:00", 30.0)
    df = metrics.long_run_pct(mem_conn)
    assert df.iloc[0]["long_run_pct"] == pytest.approx(75.0)


def test_plan_adherence_returns_dataframe(mem_conn):
    from db import upsert_training_plan_week
    from datetime import date
    upsert_training_plan_week(mem_conn, {
        "week_number": 1,
        "week_start_date": date(2024, 3, 11),
        "phase": "base",
        "planned_distance_km": 50.0,
        "planned_long_run_km": 18.0,
        "planned_sessions": 5,
        "is_deload": False,
        "notes": "",
    })
    _insert_run(mem_conn, 999, "2024-03-13T07:00:00", 45.0)
    df = metrics.plan_adherence(mem_conn)
    assert isinstance(df, pd.DataFrame)
    assert "adherence_pct" in df.columns
    row = df[df["week_number"] == 1].iloc[0]
    assert row["actual_distance_km"] == pytest.approx(45.0)
    assert row["adherence_pct"] == pytest.approx(90.0)
