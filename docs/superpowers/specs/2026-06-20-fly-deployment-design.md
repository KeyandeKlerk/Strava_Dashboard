# Fly.io Deployment with Strava Webhook — Design Spec

**Date:** 2026-06-20  
**Status:** Approved

## Goal

Deploy the Strava Dashboard (Streamlit + DuckDB) to Fly.io for free, with automatic activity syncing via a Strava webhook so the dashboard updates within seconds of completing an activity.

---

## Architecture

One Fly.io app, one container, one persistent volume.

```
Internet
  ├── fly.dev:443  ──→  Streamlit  (internal port 8501)  ──→  /app/data/training.duckdb
  └── fly.dev:8080 ──→  FastAPI    (internal port 8080)  ──┘
```

**Supervisord** manages both processes inside the container. The persistent Fly.io volume `training_data` is mounted at `/app/data`. This directory holds `training.duckdb` and survives container restarts and redeploys.

**Fly.io secrets** (set via `fly secrets set`):
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_REFRESH_TOKEN` — initial token; live token is persisted in DuckDB after first rotation
- `STRAVA_WEBHOOK_VERIFY_TOKEN` — a random string you choose, used to validate webhook origin

Dashboard is publicly accessible (no authentication required).

---

## Webhook Handler (`webhook/app.py`)

FastAPI app with two endpoints:

### `GET /webhook`
Strava challenge verification. Called once during webhook subscription registration.

- Reads `hub.verify_token` from query params; rejects if it doesn't match `STRAVA_WEBHOOK_VERIFY_TOKEN`
- Echoes back `{"hub.challenge": "<value>"}` to confirm endpoint ownership
- Must respond within 2 seconds (Strava requirement)

### `POST /webhook`
Receives activity events from Strava.

- Ignores all events except `object_type == "activity"` and `aspect_type == "create"`
- Responds `200 OK` immediately (Strava requires < 2s)
- Triggers `run_sync()` in a background thread to avoid blocking the response

---

## Token Persistence

**Problem:** `_persist_refresh_token` in `strava_client.py` currently writes the rotated refresh token to `.env`. In a container, `.env` is baked into the image at build time; changes are lost on restart. After the first token rotation the app would fail to authenticate.

**Fix:** Store the live refresh token in DuckDB's `sync_state` table (key: `strava_refresh_token`).

- `db.get_refresh_token(conn)` — reads from `sync_state`
- `db.set_refresh_token(conn, token)` — writes to `sync_state`
- `refresh_access_token()` — reads from DuckDB first (via a temporary connection), falls back to `STRAVA_REFRESH_TOKEN` env var
- `_persist_refresh_token()` — writes to DuckDB instead of `.env`

The persistent volume is the single source of truth for both activity data and the live refresh token.

`strava_client.py` will import `get_conn`, `get_refresh_token`, and `set_refresh_token` from `db.py`. No circular import risk — `db.py` does not import `strava_client.py`.

**DuckDB concurrency:** Both Streamlit and FastAPI open write connections to the same DuckDB file. Conflicts are avoided by keeping connections short-lived and never cached — each sync call opens a connection, completes, and closes it. Streamlit reruns do the same. The contention window is milliseconds; for a personal dashboard with infrequent syncs this is safe.

---

## Files

### New files

| File | Purpose |
|------|---------|
| `Dockerfile` | Python 3.12-slim image, installs deps, copies code, runs supervisord |
| `supervisord.conf` | Manages Streamlit (port 8501) and uvicorn/FastAPI (port 8080) |
| `webhook/app.py` | FastAPI webhook handler |
| `webhook/__init__.py` | Empty, makes webhook a package |
| `fly.toml` | App config: volume mount at `/app/data`, two services |
| `.gitignore` | Excludes `.env`, `data/`, `__pycache__`, `*.duckdb` |
| `.dockerignore` | Excludes `.env`, `data/`, `.git`, `__pycache__` |

### Modified files

| File | Change |
|------|--------|
| `src/strava_client.py` | `_persist_refresh_token` writes to DuckDB; `refresh_access_token` reads DuckDB first |
| `src/db.py` | Add `get_refresh_token(conn)` and `set_refresh_token(conn, token)` |

---

## `fly.toml` Structure

```toml
app = "strava-dashboard"   # chosen at deploy time
primary_region = "jnb"     # Johannesburg — closest to user

[build]

[[mounts]]
  source = "training_data"
  destination = "/app/data"

[[services]]
  internal_port = 8501
  protocol = "tcp"
  [[services.ports]]
    handlers = ["http"]
    port = 80
  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

[[services]]
  internal_port = 8080
  protocol = "tcp"
  [[services.ports]]
    port = 8080
```

---

## Strava Webhook Registration (one-time, post-deploy)

After deploying, register the webhook subscription with a single curl:

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET \
  -F callback_url=https://strava-dashboard.fly.dev:8080/webhook \
  -F verify_token=YOUR_VERIFY_TOKEN
```

Strava immediately hits `GET /webhook` with a challenge. FastAPI verifies and echoes it back. Strava confirms and returns a `subscription_id`. Done — all future activities will trigger `POST /webhook`.

---

## GitHub Setup

Before deploying:
1. Initialize git repo locally (`git init`, already done)
2. Create `.gitignore` (excludes secrets and data)
3. Push to a new GitHub repository (used for version control, not for CI/CD)

---

## Deployment Steps (summary)

1. Install Fly CLI, `fly auth login`
2. `fly apps create strava-dashboard`
3. `fly volumes create training_data --size 1`
4. `fly secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_REFRESH_TOKEN=... STRAVA_WEBHOOK_VERIFY_TOKEN=...`
5. `fly deploy`
6. Register Strava webhook (curl above)
7. Upload existing `training.duckdb` to the volume:
   ```bash
   fly sftp shell
   # inside sftp shell:
   put data/training.duckdb /app/data/training.duckdb
   ```

---

## Out of Scope

- Authentication / access control (dashboard is public)
- Multiple user support
- Strava webhook deletion/updates (only create events handled)
- Automated CI/CD from GitHub
