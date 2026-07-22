# Recent Activity Refresh — Design

## Problem

Manual sync (`SyncButton` → `triggerSyncAction` → `runSync` in `web/src/lib/strava/sync.ts:17`)
only calls Strava's `GET /athlete/activities?after=<lastSynced>` — it fetches activities
*created* after the last sync timestamp. Once an activity is already stored, editing its
title, description, or gear/equipment assignment on Strava is never pulled back down, no
matter how many times sync runs afterward. This matters because the Strava webhook fires
immediately on activity creation (`web/src/app/api/webhook/strava/route.ts:26`), often before
the user has assigned the correct shoes — the edit happens minutes or hours later, after the
activity is already synced.

Two gaps make this worse:

- Strava's activity list endpoint doesn't return `description` at all. The app never
  requests or stores it (`RawStravaActivity` in `web/src/lib/strava/parser.ts:5-20` has no
  `description` field, and there's no `description` column on `activities`).
- `activities.gear_name` — the column the UI actually reads (`web/src/lib/metrics.ts:417`) —
  is never written by the current TypeScript sync code. `refreshGear` (`sync.ts:55-68`) only
  upserts into the standalone `gear` table; nothing propagates the resolved name onto
  `activities.gear_name`. This is a latent bug independent of this feature, but it directly
  blocks "get new equipment," since even brand-new activities end up with `gear_name = NULL`
  today.

## Scope

- Add support for `description` end-to-end (fetch, parse, store).
- Add a step to `runSync` that re-fetches full detail for the most recently stored activities
  and applies any changes to name, description, or gear assignment — running on **every**
  sync, manual-button-triggered or webhook-triggered, since both paths call `runSync`.
- Fix `refreshGear` to also write the resolved gear name onto `activities.gear_name`.
- Out of scope: re-fetching *all* historical activities (only the most recent N), handling
  Strava "delete" webhook events, and any UI control for the refresh count (it's an env var).

## Design

### 1. Fetch full detail for a single activity

Add `getActivityById(accessToken, id)` to `web/src/lib/strava/client.ts`, calling
`GET /activities/{id}`. Unlike the list endpoint's summary representation, the single-activity
detail response includes `description` and the activity's current `gear_id` — this is the only
way to observe a post-hoc edit made in Strava.

### 2. `description` support

- `RawStravaActivity` (`parser.ts`) gains `description?: string`.
- `ActivityInput` (`web/src/lib/db/mutations.ts`) gains `description?: string | null`.
- `parseActivity` maps `raw.description ?? null`.
- Schema (`web/src/lib/db/schema.ts`): add `ALTER TABLE activities ADD COLUMN IF NOT EXISTS
  description TEXT` as its own statement in `SCHEMA_STATEMENTS`. This is the first column
  added to an already-live table in this schema (every prior schema change has been a fresh
  `CREATE TABLE IF NOT EXISTS`), so `initSchema` needs to actually run an `ALTER TABLE`, not
  rely on the create-table path.
- `upsertActivity`: add `description` to the insert column list, the `VALUES` bindings, and
  the `ON CONFLICT ... DO UPDATE SET` clause.

### 3. Recent-activity refresh step

New function in `sync.ts`, e.g. `refreshRecentActivities(conn, accessToken, count)`:

- Query the `count` most recently stored activities: `SELECT * FROM activities ORDER BY
  start_date_local DESC LIMIT count`.
- For each, call `getActivityById`, then `parseActivity` on the result.
- Compare the fetched `name`, `description`, and `gear_id` against the stored row's values —
  these are exactly the fields Strava lets you edit after the fact (matches what the user
  described: title, description, equipment). Distance/pace/HR fields are not compared — they
  don't change post-hoc and comparing them risks false positives from float rounding.
- Only call `upsertActivity` when at least one of those three fields differs, to avoid
  unnecessary writes and `synced_at` bumps on unchanged activities.
- Called from `runSync`, after the existing new-activity upsert loop and before
  `refreshGear` (so a gear reassignment picked up here is included in the same gear-id set
  `refreshGear` resolves names for).
- `count` comes from a new env var `STRAVA_RECENT_REFRESH_COUNT`, parsed as an integer,
  defaulting to `5` if unset or invalid. This keeps it adjustable (e.g. bump it temporarily
  after a multi-day gap in syncing) without a UI control, consistent with how other Strava
  config (`STRAVA_CLIENT_ID` etc.) already lives in env vars.

### 4. Fix `gear_name` propagation

Extend `refreshGear` (`sync.ts:55-68`): after resolving each gear id's current name via
`getGear` and upserting it into the `gear` table, also run `UPDATE activities SET gear_name =
$name WHERE gear_id = $id` for that gear id. This ensures both a shoe rename *and* a shoe
reassignment (surfaced by step 3's `gear_id` diff) actually show up in the UI, and separately
fixes brand-new activities never getting a `gear_name` at all under the current code.

### 5. Webhook and manual sync — no changes needed

The webhook handler (`route.ts`) keeps its existing `aspect_type === "create"` gate and just
re-invokes `runSync` on new-activity events; `runSync` itself now always includes the
recent-activity refresh, so the fix applies uniformly whether sync was triggered by the button
or by a webhook. No separate "full refresh" button, no new server action.

## Error handling

`getActivityById` reuses the existing `stravaFetch` error handling (throws on non-OK
response). A failure fetching one recent activity's detail should not abort the rest of
`runSync` — wrap each iteration's fetch/compare/upsert in a try/catch that logs and continues,
matching the fire-and-forget nature of `runSync` (it already runs detached via `after()` in
`triggerSyncAction`, with no surfaced failure state in the UI).

## Testing

- `parseActivity` maps `description` correctly (present, absent).
- `upsertActivity` persists and updates `description`.
- Comparison logic: given a stored row and a freshly parsed one, only diffs on
  name/description/gear_id trigger an upsert; unrelated fields differing (e.g. rounding) do
  not.
- `refreshGear` writes `gear_name` onto matching `activities` rows, not just the `gear` table.
- `STRAVA_RECENT_REFRESH_COUNT` env var: unset/invalid falls back to 5.
