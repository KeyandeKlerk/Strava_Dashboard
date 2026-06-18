import sys
from pathlib import Path
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from sync import run_sync
from db import get_last_synced


RAW_ACTIVITIES = [
    {
        "id": 11111,
        "name": "Morning Run",
        "sport_type": "Run",
        "start_date_local": "2024-03-15T07:30:00Z",
        "distance": 10000.0,
        "moving_time": 3300,
        "elapsed_time": 3400,
        "total_elevation_gain": 80.0,
        "average_heartrate": 145.0,
        "max_heartrate": 162.0,
        "average_cadence": 86.0,
        "average_speed": 3.03,
        "suffer_score": 78.0,
    },
    {
        "id": 22222,
        "name": "Gym Session",
        "sport_type": "WeightTraining",
        "start_date_local": "2024-03-16T08:00:00Z",
        "distance": 0,
        "moving_time": 3600,
        "elapsed_time": 3700,
        "total_elevation_gain": 0.0,
        "average_heartrate": None,
        "max_heartrate": None,
        "average_cadence": None,
        "average_speed": 0.0,
        "suffer_score": None,
    },
]


@patch("sync.strava_client.get_activities", return_value=RAW_ACTIVITIES)
@patch("sync.strava_client.refresh_access_token", return_value="fake_token")
def test_sync_inserts_activities(mock_token, mock_get, mem_conn):
    run_sync(mem_conn)
    count = mem_conn.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
    assert count == 2


@patch("sync.strava_client.get_activities", return_value=RAW_ACTIVITIES)
@patch("sync.strava_client.refresh_access_token", return_value="fake_token")
def test_sync_updates_last_synced(mock_token, mock_get, mem_conn):
    run_sync(mem_conn)
    ts = get_last_synced(mem_conn)
    assert ts is not None
    assert ts > 0


@patch("sync.strava_client.get_activities", return_value=RAW_ACTIVITIES)
@patch("sync.strava_client.refresh_access_token", return_value="fake_token")
def test_sync_is_idempotent(mock_token, mock_get, mem_conn):
    run_sync(mem_conn)
    run_sync(mem_conn)
    count = mem_conn.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
    assert count == 2


@patch("sync.strava_client.get_activities", return_value=RAW_ACTIVITIES)
@patch("sync.strava_client.refresh_access_token", return_value="fake_token")
def test_sync_passes_after_timestamp_on_incremental(mock_token, mock_get, mem_conn):
    from db import set_last_synced
    set_last_synced(mem_conn, 1710500000)
    run_sync(mem_conn)
    _, call_kwargs = mock_get.call_args
    assert call_kwargs.get("after") == 1710500000


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
