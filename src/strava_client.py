import os
from pathlib import Path
from typing import Optional
import requests
from dotenv import load_dotenv
from db import get_conn, init_schema, get_refresh_token, set_refresh_token

load_dotenv()

TOKEN_URL = "https://www.strava.com/oauth/token"
API_BASE = "https://www.strava.com/api/v3"


def refresh_access_token() -> str:
    conn = get_conn()
    init_schema(conn)
    stored = get_refresh_token(conn)
    conn.close()

    current_refresh = stored or os.environ["STRAVA_REFRESH_TOKEN"]

    resp = requests.post(TOKEN_URL, data={
        "client_id": os.environ["STRAVA_CLIENT_ID"],
        "client_secret": os.environ["STRAVA_CLIENT_SECRET"],
        "refresh_token": current_refresh,
        "grant_type": "refresh_token",
    })
    resp.raise_for_status()
    data = resp.json()

    new_refresh = data.get("refresh_token", "")
    if new_refresh and new_refresh != current_refresh:
        _persist_refresh_token(new_refresh)
        os.environ["STRAVA_REFRESH_TOKEN"] = new_refresh

    return data["access_token"]


def _persist_refresh_token(token: str) -> None:
    conn = get_conn()
    init_schema(conn)
    set_refresh_token(conn, token)
    conn.close()


def get_activities(
    access_token: str,
    after: Optional[int] = None,
    per_page: int = 200,
) -> list[dict]:
    headers = {"Authorization": f"Bearer {access_token}"}
    activities: list[dict] = []
    page = 1

    while True:
        params: dict = {"per_page": per_page, "page": page}
        if after is not None:
            params["after"] = after

        resp = requests.get(f"{API_BASE}/athlete/activities", headers=headers, params=params)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        activities.extend(batch)
        page += 1

    return activities


def get_activity_streams(access_token: str, activity_id: int) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    keys = "heartrate,altitude,velocity_smooth,grade_smooth,cadence"
    resp = requests.get(
        f"{API_BASE}/activities/{activity_id}/streams",
        headers=headers,
        params={"keys": keys, "key_by_type": "true"},
    )
    resp.raise_for_status()
    return resp.json()


def get_gear(access_token: str, gear_id: str) -> dict | None:
    headers = {"Authorization": f"Bearer {access_token}"}
    resp = requests.get(f"{API_BASE}/gear/{gear_id}", headers=headers)
    if resp.status_code == 200:
        return resp.json()
    return None
