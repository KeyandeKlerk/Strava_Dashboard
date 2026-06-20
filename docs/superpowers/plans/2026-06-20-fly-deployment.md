# Fly.io Deployment with Strava Webhook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Strava Dashboard (Streamlit + DuckDB) to Fly.io with automatic activity syncing via Strava webhooks, including all infrastructure, code changes, and one-time deployment steps.

**Architecture:** Single Docker container managed by supervisord runs Streamlit (port 8501, exposed as the dashboard) and FastAPI/uvicorn (port 8080, webhook receiver). A persistent Fly.io volume at `/app/data` holds `training.duckdb` and the live Strava refresh token across restarts.

**Tech Stack:** Python 3.12, Streamlit, FastAPI, uvicorn, DuckDB, supervisord, Fly.io, Strava Webhooks API

## Global Constraints

- DuckDB path in the container: `DB_PATH = Path(__file__).parent.parent / "data" / "training.duckdb"` resolves to `/app/data/training.duckdb` — matches the volume mount, no code change needed
- All DB connections must be short-lived (open → use → close), never cached — prevents multi-process write contention
- Strava requires webhook responses within 2 seconds; POST /webhook must respond immediately and trigger sync in a background thread
- Run tests with: `pytest tests/ -v` from project root
- `category_map.yaml` is COPY'd into the image as-is; no change needed

---

### Task 1: Git hygiene and GitHub push

**Files:**
- Create: `.gitignore`
- Create: `.dockerignore` (included here to keep both ignore files together)

**Interfaces:**
- Produces: clean repo with no secrets or data files committed; `.gitignore` and `.dockerignore` available for subsequent tasks

- [ ] **Step 1: Create `.gitignore`**

```
.env
data/
__pycache__/
*.py[cod]
*.duckdb
.DS_Store
.venv/
```

- [ ] **Step 2: Create `.dockerignore`**

```
.env
data/
.git
__pycache__
*.pyc
*.duckdb
.DS_Store
docs/
tests/
.venv/
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore .dockerignore
git commit -m "chore: add .gitignore and .dockerignore for deployment"
```

- [ ] **Step 4: Push to GitHub**

Create a new private GitHub repo (via the GitHub web UI or `gh repo create strava-dashboard --private`), then:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/strava-dashboard.git
git push -u origin master
```

Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.

---

### Task 2: DuckDB refresh token helpers

**Files:**
- Modify: `src/db.py` — add `get_refresh_token` and `set_refresh_token` at the bottom of the file
- Test: `tests/test_db.py` — append three new test functions

**Interfaces:**
- Produces:
  - `get_refresh_token(conn: duckdb.DuckDBPyConnection) -> Optional[str]`
  - `set_refresh_token(conn: duckdb.DuckDBPyConnection, token: str) -> None`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_db.py`:

```python
from db import get_refresh_token, set_refresh_token


def test_get_refresh_token_returns_none_when_unset(mem_conn):
    assert get_refresh_token(mem_conn) is None


def test_set_and_get_refresh_token(mem_conn):
    set_refresh_token(mem_conn, "my_refresh_token")
    assert get_refresh_token(mem_conn) == "my_refresh_token"


def test_set_refresh_token_overwrites_existing(mem_conn):
    set_refresh_token(mem_conn, "old_token")
    set_refresh_token(mem_conn, "new_token")
    assert get_refresh_token(mem_conn) == "new_token"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_db.py::test_get_refresh_token_returns_none_when_unset tests/test_db.py::test_set_and_get_refresh_token tests/test_db.py::test_set_refresh_token_overwrites_existing -v
```

Expected: FAIL with `ImportError: cannot import name 'get_refresh_token'`

- [ ] **Step 3: Implement the helpers in `src/db.py`**

Append to the bottom of `src/db.py` (after the last existing function):

```python
def get_refresh_token(conn: duckdb.DuckDBPyConnection) -> Optional[str]:
    result = conn.execute(
        "SELECT value FROM sync_state WHERE key = 'strava_refresh_token'"
    ).fetchone()
    return result[0] if result else None


def set_refresh_token(conn: duckdb.DuckDBPyConnection, token: str) -> None:
    conn.execute("""
        INSERT INTO sync_state (key, value) VALUES ('strava_refresh_token', ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
    """, [token])
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_db.py::test_get_refresh_token_returns_none_when_unset tests/test_db.py::test_set_and_get_refresh_token tests/test_db.py::test_set_refresh_token_overwrites_existing -v
```

Expected: 3 passed

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
pytest tests/ -v
```

Expected: all existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/db.py tests/test_db.py
git commit -m "feat: add DuckDB refresh token persistence helpers"
```

---

### Task 3: Update strava_client token persistence

Replace `.env`-based token persistence with DuckDB storage. `refresh_access_token` now reads the current refresh token from DuckDB first (falling back to the env var), and `_persist_refresh_token` writes to DuckDB instead of `.env`.

**Files:**
- Modify: `src/strava_client.py` — update imports, `refresh_access_token`, `_persist_refresh_token`
- Test: `tests/test_strava_client.py` — update existing token test + add two new tests

**Interfaces:**
- Consumes: `get_conn`, `init_schema`, `get_refresh_token`, `set_refresh_token` from `db.py` (Task 2)
- Produces: `refresh_access_token() -> str` (signature unchanged; now DB-aware)

- [ ] **Step 1: Write the failing tests**

Replace the content of `tests/test_strava_client.py` with the following (keeps the three existing passing tests, updates the one that will break, adds two new ones):

```python
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
```

- [ ] **Step 2: Run tests to verify the updated token test fails**

```bash
pytest tests/test_strava_client.py -v
```

Expected: `test_refresh_access_token_returns_token` FAIL (mock mismatch), new tests FAIL (not yet implemented)

- [ ] **Step 3: Update `src/strava_client.py`**

Replace the full content of `src/strava_client.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_strava_client.py -v
```

Expected: 6 passed

- [ ] **Step 5: Run full test suite**

```bash
pytest tests/ -v
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/strava_client.py tests/test_strava_client.py
git commit -m "feat: persist Strava refresh token in DuckDB instead of .env"
```

---

### Task 4: FastAPI webhook handler

**Files:**
- Modify: `requirements.txt` — add fastapi, uvicorn, httpx
- Create: `webhook/__init__.py`
- Create: `webhook/app.py`
- Create: `tests/test_webhook.py`

**Interfaces:**
- Consumes: `run_sync()` from `src/sync.py`
- Produces:
  - `GET /webhook` — Strava challenge verification endpoint
  - `POST /webhook` — activity event receiver, triggers `run_sync()` in background thread

- [ ] **Step 1: Add dependencies to `requirements.txt`**

Append to `requirements.txt`:

```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
httpx>=0.27.0
```

Install them:

```bash
pip install fastapi>=0.111.0 "uvicorn[standard]>=0.29.0" httpx>=0.27.0
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_webhook.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_webhook.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'webhook'`

- [ ] **Step 4: Create `webhook/__init__.py`**

Create an empty file at `webhook/__init__.py`.

- [ ] **Step 5: Create `webhook/app.py`**

```python
import os
import threading
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.responses import JSONResponse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from sync import run_sync

app = FastAPI()


@app.get("/webhook")
def verify_webhook(
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
):
    verify_token = os.environ.get("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
    if hub_verify_token != verify_token:
        raise HTTPException(status_code=403, detail="Invalid verify token")
    return JSONResponse({"hub.challenge": hub_challenge})


@app.post("/webhook")
async def receive_event(request: Request):
    body = await request.json()
    if body.get("object_type") == "activity" and body.get("aspect_type") == "create":
        threading.Thread(target=run_sync, daemon=True).start()
    return {"status": "ok"}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pytest tests/test_webhook.py -v
```

Expected: 5 passed

- [ ] **Step 7: Run full test suite**

```bash
pytest tests/ -v
```

Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add requirements.txt webhook/__init__.py webhook/app.py tests/test_webhook.py
git commit -m "feat: add FastAPI webhook handler for Strava activity events"
```

---

### Task 5: Container config

**Files:**
- Modify: `requirements.txt` — add `supervisor`
- Create: `Dockerfile`
- Create: `supervisord.conf`

**Interfaces:**
- Produces: a buildable Docker image that runs both Streamlit and FastAPI under supervisord

- [ ] **Step 1: Add supervisor to `requirements.txt`**

Append to `requirements.txt`:

```
supervisor>=4.2.0
```

- [ ] **Step 2: Create `supervisord.conf`**

```ini
[supervisord]
nodaemon=true
logfile=/dev/stdout
logfile_maxbytes=0
loglevel=info

[program:streamlit]
command=streamlit run /app/dashboard/app.py --server.port=8501 --server.address=0.0.0.0 --server.headless=true
directory=/app
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
autorestart=true
startretries=3

[program:webhook]
command=uvicorn webhook.app:app --host 0.0.0.0 --port 8080
directory=/app
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
autorestart=true
startretries=3
```

- [ ] **Step 3: Create `Dockerfile`**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data

EXPOSE 8501 8080

CMD ["supervisord", "-c", "/app/supervisord.conf", "-n"]
```

- [ ] **Step 4: Build the image locally to verify it compiles**

```bash
docker build -t strava-dashboard:local .
```

Expected: build completes with no errors. The final line should be something like:
```
=> => naming to docker.io/library/strava-dashboard:local
```

If you don't have Docker installed locally, skip this step — Fly.io will build it remotely during `fly deploy`.

- [ ] **Step 5: Commit**

```bash
git add requirements.txt supervisord.conf Dockerfile
git commit -m "feat: add Dockerfile and supervisord config for Fly.io deployment"
```

---

### Task 6: Fly.io config

**Files:**
- Create: `fly.toml`

**Interfaces:**
- Produces: Fly.io app config with two services (Streamlit on 443, webhook on 8080) and volume mount

- [ ] **Step 1: Create `fly.toml`**

```toml
app = "strava-dashboard"
primary_region = "jnb"

[build]

[[mounts]]
  source = "training_data"
  destination = "/app/data"

[[services]]
  internal_port = 8501
  protocol = "tcp"
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

  [[services.ports]]
    handlers = ["http"]
    port = 80
    force_https = true

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [services.concurrency]
    type = "connections"
    hard_limit = 25
    soft_limit = 20

[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    port = 8080
```

Note: `auto_stop_machines = false` and `min_machines_running = 1` keep the machine always running so the webhook is always reachable. The app name `strava-dashboard` must match the name you choose in Step 2 of Task 7.

- [ ] **Step 2: Commit**

```bash
git add fly.toml
git commit -m "feat: add fly.toml for Fly.io deployment config"
git push
```

---

### Task 7: Deploy to Fly.io and register Strava webhook

This task is entirely manual — no code to write.

**Prerequisites:**
- All previous tasks committed and pushed to GitHub
- Your Strava API credentials from `.env`: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`
- Choose a `STRAVA_WEBHOOK_VERIFY_TOKEN` — any random string, e.g. `openssl rand -hex 16`

- [ ] **Step 1: Install Fly CLI**

```bash
curl -L https://fly.io/install.sh | sh
```

Then add it to your PATH as instructed by the installer, and log in:

```bash
fly auth login
```

This opens a browser to authenticate.

- [ ] **Step 2: Create the Fly.io app**

```bash
fly apps create strava-dashboard
```

If `strava-dashboard` is taken, choose another name (e.g. `keyan-strava-dashboard`) and update the `app = ` line in `fly.toml` to match.

- [ ] **Step 3: Create the persistent volume**

```bash
fly volumes create training_data --size 1 --region jnb
```

This creates a 1GB volume in Johannesburg. Confirm with `y` if prompted.

- [ ] **Step 4: Set secrets**

```bash
fly secrets set \
  STRAVA_CLIENT_ID=YOUR_CLIENT_ID \
  STRAVA_CLIENT_SECRET=YOUR_CLIENT_SECRET \
  STRAVA_REFRESH_TOKEN=YOUR_REFRESH_TOKEN \
  STRAVA_WEBHOOK_VERIFY_TOKEN=YOUR_CHOSEN_VERIFY_TOKEN
```

Replace each `YOUR_*` with the actual values from `.env` and your chosen verify token.

- [ ] **Step 5: Deploy**

```bash
fly deploy
```

Fly.io builds the Docker image and deploys it. This takes 2–5 minutes. When complete you'll see:

```
==> Monitoring deployment
 1 desired, 1 placed, 1 healthy, 0 unhealthy [health checks: 1 total]
```

- [ ] **Step 6: Verify the dashboard is live**

Open `https://strava-dashboard.fly.dev` (or your chosen app name) in a browser. You should see the Comrades 2027 Training Dashboard with an empty state (no data yet — that comes in Step 8).

- [ ] **Step 7: Verify the webhook endpoint is reachable**

```bash
curl "https://strava-dashboard.fly.dev:8080/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=testchallenge"
```

Expected response: `{"hub.challenge":"testchallenge"}`

- [ ] **Step 8: Upload your existing training data**

```bash
fly sftp shell
```

Inside the sftp shell:

```
put data/training.duckdb /app/data/training.duckdb
exit
```

Then restart the machine to pick up the uploaded file:

```bash
fly machine restart
```

Wait ~30 seconds, then reload the dashboard — your historical data should appear.

- [ ] **Step 9: Register the Strava webhook subscription**

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET \
  -F callback_url=https://strava-dashboard.fly.dev:8080/webhook \
  -F verify_token=YOUR_VERIFY_TOKEN
```

Expected response (Strava confirms with a subscription ID):

```json
{"id": 123456}
```

If you get an error, check that the webhook endpoint returns the challenge correctly (Step 7).

- [ ] **Step 10: End-to-end verification**

Save a manual activity on Strava (or wait for your next run). Within a few seconds the Strava webhook fires. Check the Fly.io logs to confirm:

```bash
fly logs
```

You should see lines from the webhook process like:
```
INFO:     POST /webhook HTTP/1.1" 200
Fetching activities after ...
Sync complete. 1 activities processed.
```

Reload the dashboard — the new activity should appear.
