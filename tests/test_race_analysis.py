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
