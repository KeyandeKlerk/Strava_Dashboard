import sys
from pathlib import Path
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).parent.parent))

with patch("strava_client.get_conn"), \
     patch("strava_client.init_schema"), \
     patch("strava_client.get_refresh_token", return_value=None):
    from fastapi.testclient import TestClient
    from webhook.app import app

client = TestClient(app)


def test_verify_webhook_correct_token():
    with patch.dict("os.environ", {"STRAVA_WEBHOOK_VERIFY_TOKEN": "secret123"}):
        resp = client.get("/webhook", params={
            "hub.mode": "subscribe",
            "hub.verify_token": "secret123",
            "hub.challenge": "abc123",
        })
    assert resp.status_code == 200
    assert resp.json() == {"hub.challenge": "abc123"}


def test_verify_webhook_wrong_token_returns_403():
    with patch.dict("os.environ", {"STRAVA_WEBHOOK_VERIFY_TOKEN": "secret123"}):
        resp = client.get("/webhook", params={
            "hub.mode": "subscribe",
            "hub.verify_token": "wrong_token",
            "hub.challenge": "abc123",
        })
    assert resp.status_code == 403


def test_post_activity_create_triggers_sync():
    with patch("webhook.app.threading") as mock_threading:
        mock_thread = MagicMock()
        mock_threading.Thread.return_value = mock_thread
        resp = client.post("/webhook", json={
            "object_type": "activity",
            "aspect_type": "create",
            "object_id": 12345678,
            "owner_id": 999,
        })
    assert resp.status_code == 200
    mock_threading.Thread.assert_called_once()
    mock_thread.start.assert_called_once()


def test_post_athlete_event_ignored():
    with patch("webhook.app.threading") as mock_threading:
        resp = client.post("/webhook", json={
            "object_type": "athlete",
            "aspect_type": "update",
            "object_id": 999,
        })
    assert resp.status_code == 200
    mock_threading.Thread.assert_not_called()


def test_post_activity_update_event_ignored():
    with patch("webhook.app.threading") as mock_threading:
        resp = client.post("/webhook", json={
            "object_type": "activity",
            "aspect_type": "update",
            "object_id": 12345678,
        })
    assert resp.status_code == 200
    mock_threading.Thread.assert_not_called()
