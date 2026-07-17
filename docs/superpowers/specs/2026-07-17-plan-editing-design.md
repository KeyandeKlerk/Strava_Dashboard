# Plan Editing — Design

## Problem

The training plan (`training_plan_daily`) is currently read-only in the dashboard: sessions
can only be created in bulk via CSV import (`plan-history/actions.ts`'s `importPlanCsv`).
There's no way to reshuffle a week — move a workout to a different day, remove one, or add
one — without re-uploading the whole CSV.

## Scope

- Move a workout to a different day **within the same week only**. No cross-week moves; the
  week's aggregate rollup (`training_plan`) never needs recomputing across two weeks.
- Remove a workout from the plan (delete its row).
- Add a new workout to a day within a given week.
- Editing is **read-only once a session is marked `completed`** (has a matched Strava
  activity) — locked sessions can't be moved, removed, or be a swap target. This protects
  training history and avoids orphaning `completed_activity_id` matches.
- Available on **both** the Today tab (current week) and the Plan & History tab's week
  explorer (any week), via one shared component.
- A day can hold **more than one session of the same type** (e.g. a volleyball session and a
  separate cycling session, both categorized `cross_training`) — see Schema migration below.
  This wasn't previously representable at all: `training_plan_daily`'s primary key was
  `(planned_date, session_type)`, so a second same-type session on a day would silently
  overwrite the first.

## Interaction model

Tapping a non-completed workout opens an edit sheet — a bottom-sheet modal — rather than a
stateful "select source, then tap target" list interaction. This keeps move/remove/add on one
consistent UI surface instead of three different interaction models, and avoids ambiguity
about what's currently selected once a day holds multiple sessions.

- **Edit sheet** (opened by tapping a session): shows the session's icon, type, description,
  and distance. Below that, a row of 7 day buttons for the session's current week
  (Mon–Sun, computed from `week_start_date`, not from the sessions that happen to exist —
  so an empty day is still a valid move target). The button for the session's own current
  day is disabled. Moving is a **swap** with whatever's on the target day if there's exactly
  one existing session of the same type there; if that one session is *completed*, or if the
  target day already holds *two or more* sessions of that type (ambiguous — which one would
  it swap with?), the day button is disabled with an inline reason ("Wed's easy run is already
  done" / "Thursday already has 2 easy runs — remove one first or pick a different day").
  Below the day row is a "Remove from plan" button. Cancel closes without changes.
- **Add workout**: a "+ Add workout" row at the end of each week's session list opens the same
  sheet shape in create mode — day picker (that week's 7 days), session-type select (`rest`,
  `sc`, `easy_run`, `quality_run`, `long_run`, `hills`, `cross_training`, `cricket`, `race`),
  distance (km) number input, intensity select (`easy`, `moderate`, `hard`, `race`, `rest`),
  description text input. This always inserts a new row — with the surrogate `id` primary key
  (see Schema migration below), a day can hold any number of sessions, including more than one
  of the same type, so there's nothing to overwrite or block.
  `SESSION_ICON` (`src/lib/shared.ts`) is missing an entry for `cross_training` — it currently
  falls back to the generic ⬜ used for `rest`, which would make the two indistinguishable once
  `cross_training` is exposed as a real, pickable option here. Adding an icon for it is a small
  in-scope fix alongside this feature.
- Completed session cards render with no tap affordance at all (no cursor change, no
  chevron) — "locked" is visible before you try to interact, not discovered as an error
  afterward.

## Schema migration

`training_plan_daily`'s primary key changes from `(planned_date, session_type)` to a
surrogate `id INTEGER PRIMARY KEY DEFAULT nextval('training_plan_daily_id_seq')` — the same
sequence-backed pattern already used for `race_events`/`training_blocks`. `(planned_date,
session_type)` is no longer unique.

Production runs on MotherDuck, where `initSchema` is deliberately skipped (per the existing
comment in `db/client.ts` — running `CREATE TABLE IF NOT EXISTS` against a live MotherDuck
table risks catalog write-write conflicts, and the schema there was set up by a one-time
migration, not by the app). So editing `schema.ts` alone won't change the live table. This
needs an actual migration script — following the existing `web/scripts/migrate-to-motherduck.ts`
pattern — that:

1. Creates `training_plan_daily_id_seq`.
2. Creates a new table with the surrogate-`id` shape.
3. Copies existing rows across, generating `id`s via `nextval(...)` as it goes.
4. Drops the old `training_plan_daily`, renames the new table into place.

This runs once against the live database. I'll write the script as part of implementation, but
**running it against production is a separate, explicit step** — same as the deploy gating
we've been doing all along, not something bundled silently into a commit.

Separately, `schema.ts`'s `training_plan_daily` `CREATE TABLE` statement also needs updating to
the surrogate-`id` shape — that's what backs local dev and the test suite's `:memory:` database
(`initSchema` runs there, just not against MotherDuck), so it needs to match the migrated
production shape.

## Data layer

New mutations in `src/lib/db/mutations.ts`, all keyed by the new `id` rather than
`(planned_date, session_type)`:

- **`moveDailySession(conn, { id, toDate })`**
  - Looks up the source row by `id`; rejects if it's `completed`.
  - Recomputes `day_of_week` for `toDate`.
  - Finds existing sessions on `toDate` with the same `session_type` (excluding the source
    row itself):
    - Exactly one, and it's not `completed` → swap: update the source row's `planned_date`/
      `day_of_week` to the target's, and the target row's to the source's old values. Two
      `UPDATE ... WHERE id = ...` calls inside `BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK`
      (matching the existing pattern in `upsertHrZones`) — no PK-collision risk with a
      surrogate key, so no sentinel-date dance needed.
    - Exactly one, but it's `completed`, or two-or-more exist → throws (surfaced as the
      blocked-target error; the UI already disables that day button for the same reason).
    - None → plain `UPDATE training_plan_daily SET planned_date, day_of_week WHERE id = $id`.
- **`deleteDailySession(conn, { id })`** — `DELETE FROM training_plan_daily WHERE id = $id
  AND NOT completed`.
- **`addDailySession(conn, input)`** — plain `INSERT` (no `ON CONFLICT`; there's no longer a
  uniqueness constraint to conflict with). Replaces the current `upsertDailySession`, which
  is only otherwise used by CSV import (`clearTrainingPlan` already wipes the table first, so
  switching that call to a plain insert too is behavior-preserving).
- All three are followed by `syncWeeklyFromDaily(conn)` (refresh the week's rollup numbers)
  and `correlateActivitiesToPlan(conn)` (in case the new/moved slot now lines up with an
  already-logged activity), matching the existing CSV-import action's pattern.
- `DailyPlanRow` (`src/lib/metrics.ts`) and `dailyPlanForWeek`'s query gain the `id` column —
  the client needs it as both the React key and the mutation target now that
  `(planned_date, session_type)` no longer uniquely identifies a row.

**Server actions** — new `src/lib/planActions.ts` (`"use server"`), shared by both pages
rather than duplicated per route:

- `moveDailySessionAction(id, toDate)`
- `deleteDailySessionAction(id)`
- `addDailySessionAction(formData)`

Each returns `{ error?: string }` (matching the existing `ImportPlanState` pattern) instead of
throwing, so the sheet can show an inline error and stay open rather than crashing to an error
boundary. Each calls `updateTag(DASHBOARD_DATA_TAG)` plus `revalidatePath("/today")` and
`revalidatePath("/plan-history")` — both pages render plan data, so both need invalidating
regardless of which page the edit happened on.

## Component changes

- `DailySessionList` becomes a client component. Both `today/page.tsx` and `WeekExplorer.tsx`
  pass a new `weekStartDate` prop alongside the existing `daily`/`today` props, so the sheet
  can enumerate all 7 days of the week regardless of which currently have rows.
- New `EditSessionSheet` component (shared by both pages), covering both edit mode (opened
  from a session tap) and create mode (opened from "+ Add workout").
- While an action is in flight, the sheet's buttons disable and show a brief loading state; no
  optimistic client-side state — the sheet closes on success and revalidation refreshes the
  real data. This avoids the sheet's view of the world drifting from the server's mid-swap.

## Testing

The project's only existing test coverage is backend/data-layer (`metrics.test.ts`, in-memory
DuckDB, `vitest` `node` environment — no component-rendering infrastructure exists). This adds
equivalent unit tests, against the migrated schema, for `moveDailySession` (plain move,
swap-with-one-existing, blocked-when-target-completed, blocked-when-target-has-two-or-more)
and `deleteDailySession` (blocked-when-completed) in the same style. The edit sheet's UI is
verified manually by running the dev server — adding component-rendering infrastructure
(jsdom + testing-library) solely for this feature would be disproportionate.
