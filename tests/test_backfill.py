# tests/test_backfill.py
import sys
from pathlib import Path
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from backfill import run_backfill
from db import upsert_activity, get_hr_zones

SAMPLE_ACTIVITY = {
    "id": 2001,
    "name": "Easy Run",
    "sport_type": "Run",
    "category": "running",
    "start_date_local": "2026-07-01T06:00:00",
    "distance_km": 10.0,
    "moving_time_min": 55.0,
    "elapsed_time_min": 57.0,
    "elevation_gain_m": 50.0,
    "average_heartrate": 140.0,
    "max_heartrate": 155.0,
    "average_cadence": 170.0,
    "average_speed_kmh": 10.9,
    "relative_effort": 60.0,
    "load_score": 60.0,
}

FAKE_ZONES_RESPONSE = {
    "heart_rate": {
        "custom_zones": True,
        "zones": [
            {"min": 0, "max": 120},
            {"min": 120, "max": 140},
            {"min": 140, "max": 160},
            {"min": 160, "max": 180},
            {"min": 180, "max": -1},
        ],
    }
}

FAKE_STREAMS = {
    "heartrate": {"data": [130] * 100},
    "altitude": {"data": []},
    "velocity_smooth": {"data": []},
    "grade_smooth": {"data": []},
    "cadence": {"data": []},
}


@patch("backfill.strava_client.get_activity_streams", return_value=FAKE_STREAMS)
@patch("backfill.strava_client.get_athlete_zones", return_value=FAKE_ZONES_RESPONSE)
@patch("backfill.strava_client.refresh_access_token", return_value="fake_token")
@patch("backfill.time.sleep")
def test_run_backfill_caches_zones_from_strava(mock_sleep, mock_token, mock_zones, mock_streams, mem_conn):
    upsert_activity(mem_conn, SAMPLE_ACTIVITY)
    run_backfill(mem_conn)
    zones = get_hr_zones(mem_conn)
    assert zones == [(0, 120), (120, 140), (140, 160), (160, 180), (180, 9999)]


@patch("backfill.strava_client.get_activity_streams", return_value=FAKE_STREAMS)
@patch("backfill.strava_client.get_athlete_zones", return_value=FAKE_ZONES_RESPONSE)
@patch("backfill.strava_client.refresh_access_token", return_value="fake_token")
@patch("backfill.time.sleep")
def test_run_backfill_uses_cached_zones_for_bucketing(mock_sleep, mock_token, mock_zones, mock_streams, mem_conn):
    upsert_activity(mem_conn, SAMPLE_ACTIVITY)
    run_backfill(mem_conn)
    row = mem_conn.execute(
        "SELECT pct_time_z2 FROM activity_streams_derived WHERE activity_id = 2001"
    ).fetchone()
    # HR=130 falls in custom zone 2 (120-140) -> 100% of samples in z2
    assert row[0] == pytest.approx(100.0)


@patch("backfill.strava_client.get_activity_streams", return_value=FAKE_STREAMS)
@patch("backfill.strava_client.get_athlete_zones", side_effect=Exception("network error"))
@patch("backfill.strava_client.refresh_access_token", return_value="fake_token")
@patch("backfill.time.sleep")
def test_run_backfill_falls_back_to_cache_on_fetch_failure(mock_sleep, mock_token, mock_zones, mock_streams, mem_conn):
    from db import upsert_hr_zones
    upsert_hr_zones(mem_conn, [(0, 130), (130, 148), (148, 162), (162, 174), (174, 9999)])
    upsert_activity(mem_conn, SAMPLE_ACTIVITY)
    run_backfill(mem_conn)  # must not raise, falls back to pre-seeded cache
    zones = get_hr_zones(mem_conn)
    assert zones == [(0, 130), (130, 148), (148, 162), (162, 174), (174, 9999)]


@patch("backfill.strava_client.get_activity_streams", return_value=FAKE_STREAMS)
@patch("backfill.strava_client.get_athlete_zones", return_value=FAKE_ZONES_RESPONSE)
@patch("backfill.strava_client.refresh_access_token", return_value="fake_token")
@patch("backfill.time.sleep")
def test_run_backfill_force_recomputes_existing_rows(mock_sleep, mock_token, mock_zones, mock_streams, mem_conn):
    upsert_activity(mem_conn, SAMPLE_ACTIVITY)
    run_backfill(mem_conn)  # first pass, populates activity_streams_derived
    assert mock_streams.call_count == 1

    run_backfill(mem_conn)  # second pass, default force=False -> no candidates left
    assert mock_streams.call_count == 1

    run_backfill(mem_conn, force=True)  # force=True -> recomputes the same row
    assert mock_streams.call_count == 2
