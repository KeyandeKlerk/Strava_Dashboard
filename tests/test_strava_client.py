import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from unittest.mock import patch, MagicMock, call
from strava_client import refresh_access_token, get_activities, get_activity_streams


@patch("strava_client.get_refresh_token", return_value=None)
@patch("strava_client.init_schema")
@patch("strava_client.get_conn")
@patch("strava_client.requests.post")
def test_refresh_access_token_returns_token(mock_post, mock_get_conn, mock_init, mock_get_refresh):
    mock_get_conn.return_value = MagicMock()
    mock_post.return_value.json.return_value = {
        "access_token": "new_token_abc",
        "refresh_token": "same_refresh_token",
    }
    mock_post.return_value.raise_for_status = MagicMock()

    with patch.dict("os.environ", {
        "STRAVA_CLIENT_ID": "123",
        "STRAVA_CLIENT_SECRET": "secret",
        "STRAVA_REFRESH_TOKEN": "same_refresh_token",
    }):
        token = refresh_access_token()

    assert token == "new_token_abc"


@patch("strava_client.set_refresh_token")
@patch("strava_client.get_refresh_token", return_value="db_stored_token")
@patch("strava_client.init_schema")
@patch("strava_client.get_conn")
@patch("strava_client.requests.post")
def test_refresh_uses_db_token_over_env(mock_post, mock_get_conn, mock_init, mock_get_refresh, mock_set_refresh):
    mock_get_conn.return_value = MagicMock()
    mock_post.return_value.json.return_value = {
        "access_token": "access_xyz",
        "refresh_token": "new_rotated_token",
    }
    mock_post.return_value.raise_for_status = MagicMock()

    with patch.dict("os.environ", {
        "STRAVA_CLIENT_ID": "123",
        "STRAVA_CLIENT_SECRET": "secret",
        "STRAVA_REFRESH_TOKEN": "env_token",
    }):
        token = refresh_access_token()

    assert token == "access_xyz"
    posted_data = mock_post.call_args.kwargs["data"]
    assert posted_data["refresh_token"] == "db_stored_token"
    mock_set_refresh.assert_called_once()


@patch("strava_client.set_refresh_token")
@patch("strava_client.get_refresh_token", return_value=None)
@patch("strava_client.init_schema")
@patch("strava_client.get_conn")
@patch("strava_client.requests.post")
def test_refresh_persists_rotated_token(mock_post, mock_get_conn, mock_init, mock_get_refresh, mock_set_refresh):
    mock_get_conn.return_value = MagicMock()
    mock_post.return_value.json.return_value = {
        "access_token": "access_abc",
        "refresh_token": "brand_new_refresh",
    }
    mock_post.return_value.raise_for_status = MagicMock()

    with patch.dict("os.environ", {
        "STRAVA_CLIENT_ID": "123",
        "STRAVA_CLIENT_SECRET": "secret",
        "STRAVA_REFRESH_TOKEN": "old_env_token",
    }):
        refresh_access_token()

    mock_set_refresh.assert_called_once()
    saved_token = mock_set_refresh.call_args.args[1]
    assert saved_token == "brand_new_refresh"


@patch("strava_client.requests.get")
def test_get_activities_paginates(mock_get):
    page1 = [{"id": 1}, {"id": 2}]
    page2 = []
    mock_get.return_value.json.side_effect = [page1, page2]
    mock_get.return_value.raise_for_status = MagicMock()

    result = get_activities("token", after=None)
    assert len(result) == 2
    assert mock_get.call_count == 2


@patch("strava_client.requests.get")
def test_get_activities_passes_after_param(mock_get):
    mock_get.return_value.json.return_value = []
    mock_get.return_value.raise_for_status = MagicMock()

    get_activities("token", after=1710500000)
    call_kwargs = mock_get.call_args[1]["params"]
    assert call_kwargs["after"] == 1710500000


@patch("strava_client.requests.get")
def test_get_activity_streams_returns_dict(mock_get):
    mock_get.return_value.json.return_value = {
        "heartrate": {"data": [140, 145, 150]},
        "altitude": {"data": [100, 102, 101]},
    }
    mock_get.return_value.raise_for_status = MagicMock()

    streams = get_activity_streams("token", activity_id=9999)
    assert "heartrate" in streams
    assert streams["heartrate"]["data"] == [140, 145, 150]
