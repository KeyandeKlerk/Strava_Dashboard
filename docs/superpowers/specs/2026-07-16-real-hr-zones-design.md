# Real Strava HR Zones — Design

**Date:** 2026-07-16
**Status:** Approved, pending plan

## Motivation

Weekly time-in-zone (`src/streams.py:1`, `HR_ZONES`) is bucketed against a
hardcoded, undocumented set of bpm boundaries:

```python
HR_ZONES = [(0, 130), (130, 148), (148, 162), (162, 174), (174, 9999)]
```

These were never sourced from the athlete's actual Strava zone settings, and
there's no config or formula (max HR, LTHR, Karvonen, etc.) recorded anywhere
that justifies them. The practical symptom: genuinely easy running gets
mis-bucketed into Zone 3 whenever the real Zone 2 ceiling (as configured in
Strava) is higher than 148 bpm, which corrupts both the weekly zone chart and
the 80/20 compliance metric in `dashboard/tabs/aerobic.py`.

This design replaces the hardcoded tuple with the athlete's real zone
boundaries, fetched from Strava's `/athlete/zones` endpoint, cached locally,
and used everywhere zone bucketing happens.

## Goals

- Fetch real HR zone boundaries from Strava instead of hardcoding them.
- Cache the fetched zones locally so zone bucketing doesn't require a live
  API call per activity, and so a transient Strava API failure doesn't break
  sync.
- Recompute all existing running activities' zone data against the real
  boundaries (one-time), so historical charts are correct too, not just
  future syncs.
- Apply the same zones everywhere zone time is computed — there's a single
  call site today (`compute_streams_derived`), used by both `backfill.py`
  and (transitively, via `sync.py` → `run_backfill`) the normal sync path.

## Non-goals

- No UI changes to `dashboard/tabs/aerobic.py` — the chart already labels
  Z1–Z5 generically; showing actual bpm ranges in captions/tooltips is a
  nice-to-have left for later.
- No support for multiple athletes / multi-user zone configs — this is a
  single-athlete personal dashboard.
- No power-based zones (Strava's `/athlete/zones` also returns `power`
  zones) — out of scope, this app doesn't use power data.

## Constraint: OAuth scope

Strava's `/athlete/zones` endpoint requires the `profile:read_all` scope.
The current app only requests `activity:read_all` (`src/authorize.py:38`).
This requires a one-time re-authorization: the user re-runs `authorize.py`
after the scope is widened, generating a new refresh token with the
additional scope granted.

## Architecture / Data Flow

```
authorize.py (re-auth, one-time, user-run)
  → scope: "activity:read_all,profile:read_all"
  → new refresh_token persisted to .env / sync_state

sync.py → run_backfill(conn)
  1. access_token = strava_client.refresh_access_token()
  2. zones = strava_client.get_athlete_zones(access_token)
  3. db.upsert_hr_zones(conn, zones)          # refresh cache every run
  4. hr_zones = db.get_hr_zones(conn)         # read cache (source of truth for this run)
  5. for each candidate activity:
       streams = strava_client.get_activity_streams(...)
       derived = compute_streams_derived(streams, activity, hr_zones)
       upsert_streams_derived(conn, derived)
```

Zones are refetched from Strava at the start of every backfill/sync run (one
cheap API call) and written to the `hr_zones` cache table. Bucketing always
reads from the cache within that run, so a transient Strava failure on the
zones call falls back to the last successfully cached values rather than
crashing the whole sync.

## Components

### `src/authorize.py`
Change `scope` from `"activity:read_all"` to `"activity:read_all,profile:read_all"`.

### `src/strava_client.py`
New function:

```python
def get_athlete_zones(access_token: str) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    resp = requests.get(f"{API_BASE}/athlete/zones", headers=headers)
    resp.raise_for_status()
    return resp.json()
```

Returns Strava's raw JSON: `{"heart_rate": {"custom_zones": bool, "zones": [{"min": int, "max": int}, ...]}}`.
The last zone's `max` is `-1` (no upper bound).

### `src/db.py`
New table:

```sql
CREATE TABLE IF NOT EXISTS hr_zones (
    zone_number INTEGER PRIMARY KEY,
    min_bpm INTEGER,
    max_bpm INTEGER
)
```

New functions:

- `upsert_hr_zones(conn, zones: list[tuple[int, int]]) -> None` — replaces
  all rows (delete + insert 5 rows, zone_number = 1-indexed position).
- `get_hr_zones(conn) -> list[tuple[int, int]]` — returns `[(min, max), ...]`
  ordered by `zone_number`. Raises a clear `RuntimeError` if the table is
  empty (only possible before the very first successful fetch) telling the
  caller to run `authorize.py` / sync at least once.

### `src/streams.py`
`compute_streams_derived(streams, activity, hr_zones)` — `hr_zones` becomes
a required third parameter (`list[tuple[int, int]]`), replacing the
module-level `HR_ZONES` constant, which is deleted. No default value — every
caller must supply real zones so the wrong hardcoded numbers can't silently
reappear. The last zone's upper bound arrives from Strava as `-1`; the
caller (`backfill.py`) is responsible for mapping that to a large sentinel
(`9999`) before passing zones in, matching the existing convention in the
bucketing loop (`lo <= hr < hi`).

### `src/backfill.py`
- At the top of `run_backfill`, after obtaining `access_token`: fetch zones
  via `strava_client.get_athlete_zones`, normalize the `-1` sentinel to
  `9999`, and `db.upsert_hr_zones(conn, zones)`. On fetch failure, catch and
  log a warning, then fall through to `db.get_hr_zones(conn)` to use the
  existing cache.
- `run_backfill(conn=None, force: bool = False)` — new `force` param. When
  `True`, the candidate query drops the `LEFT JOIN ... WHERE sd.activity_id
  IS NULL` filter and instead selects all running activities, so previously
  computed rows are recomputed and overwritten (not just newly-synced ones).
- Pass `hr_zones` into `compute_streams_derived`.

### One-time historical recompute
After implementation, run `run_backfill(conn, force=True)` once (manually,
not wired into any scheduled path) to recompute all 76 existing running
activities against the real zones. This re-fetches each activity's HR
stream from Strava, rate-limited at the existing 5s/request
(`RATE_LIMIT_SLEEP`), ~6–7 minutes total. `force=True` is not exposed as a
permanent CLI flag wired into `sync.py`'s normal path — ordinary syncs keep
using the incremental (missing-rows-only) behavior.

## Error Handling

- `get_athlete_zones` failure (network error, missing scope, malformed
  response) → log a warning, fall back to whatever's cached in `hr_zones`.
- `hr_zones` cache empty **and** fetch failed → raise, with a message
  pointing at re-running `authorize.py`. This can only happen on a
  completely fresh install/re-auth where no successful fetch has ever
  occurred — never silently fall back to invented bpm numbers.

## Testing

- `tests/test_strava_client.py`: `get_athlete_zones` — success case (mocked
  `requests.get`, verify URL/headers/parsed response), following existing
  mock patterns in this file.
- `tests/test_db.py`: `upsert_hr_zones` / `get_hr_zones` round-trip;
  `upsert_hr_zones` called twice replaces rather than duplicates rows;
  `get_hr_zones` raises on empty table.
- `tests/test_streams.py`: update all `compute_streams_derived` call sites
  to pass an explicit `hr_zones` fixture (list of tuples) instead of relying
  on the deleted module constant; add a case asserting a boundary HR value
  buckets correctly against custom (non-default) zone ranges.
- `tests/test_sync.py` / backfill tests: verify `run_backfill` calls
  `get_athlete_zones` and `upsert_hr_zones` once per run; verify `force=True`
  includes activities that already have `activity_streams_derived` rows in
  the candidate set, `force=False` (default) excludes them.
- Manual verification: re-run `authorize.py`, confirm new refresh token
  saved; run `python src/sync.py`, confirm no errors and `hr_zones` table
  populated with real values; run the one-time
  `run_backfill(conn, force=True)`; reload the Aerobic tab and confirm the
  80/20 compliance number changes to reflect real zone boundaries.

## File-Level Change List

- `src/authorize.py` — widen OAuth scope
- `src/strava_client.py` — add `get_athlete_zones`
- `src/db.py` — add `hr_zones` table, `upsert_hr_zones`, `get_hr_zones`
- `src/streams.py` — `compute_streams_derived` takes `hr_zones` param;
  delete `HR_ZONES` constant
- `src/backfill.py` — fetch/cache zones each run, add `force` param, pass
  zones through
- `tests/test_strava_client.py` — add `get_athlete_zones` tests
- `tests/test_db.py` — add `hr_zones` table tests
- `tests/test_streams.py` — update call sites, add custom-zone bucketing test
- `tests/test_sync.py` — add backfill zone-fetch/cache/force tests
