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

## Interaction model

Tapping a non-completed workout opens an edit sheet — a bottom-sheet modal — rather than a
stateful "select source, then tap target" list interaction. This keeps move/remove/add on one
consistent UI surface instead of three different interaction models, and avoids ambiguity
about what's currently selected once a day holds multiple sessions.

- **Edit sheet** (opened by tapping a session): shows the session's icon, type, description,
  and distance. Below that, a row of 7 day buttons for the session's current week
  (Mon–Sun, computed from `week_start_date`, not from the sessions that happen to exist —
  so an empty day is still a valid move target). The button for the session's own current
  day is disabled. A target day button is also disabled, with an inline reason (e.g. "Wed's
  easy run is already done"), if it already holds a *completed* session of the same type.
  Below the day row is a "Remove from plan" button. Cancel closes without changes.
- **Add workout**: a "+ Add workout" row at the end of each week's session list opens the same
  sheet shape in create mode — day picker (that week's 7 days), session-type select (`rest`,
  `sc`, `easy_run`, `quality_run`, `long_run`, `hills`, `cross_training`, `cricket`, `race`),
  distance (km) number input, intensity select (`easy`, `moderate`, `hard`, `race`, `rest`),
  description text input. If the chosen day/type already has a session, `addDailySessionAction`
  overwrites it via the existing upsert semantics — unless that existing session is
  `completed`, in which case it's blocked with the same inline error as a blocked move.
  `SESSION_ICON` (`src/lib/shared.ts`) is missing an entry for `cross_training` — it currently
  falls back to the generic ⬜ used for `rest`, which would make the two indistinguishable once
  `cross_training` is exposed as a real, pickable option here. Adding an icon for it is a small
  in-scope fix alongside this feature.
- Completed session cards render with no tap affordance at all (no cursor change, no
  chevron) — "locked" is visible before you try to interact, not discovered as an error
  afterward.

## Data layer

New mutations in `src/lib/db/mutations.ts`:

- **`moveDailySession(conn, { fromDate, sessionType, toDate })`**
  - Recomputes `day_of_week` for `toDate`.
  - If a session of the same `sessionType` already exists on `toDate`:
    - If it's `completed` → throws (surfaced as the blocked-target error).
    - Otherwise, swaps the two rows' dates atomically inside a transaction: move the source
      row to a sentinel placeholder date, move the existing target row into the source's old
      date, then move the sentinel row into `toDate`. This avoids a transient PK collision on
      `(planned_date, session_type)` mid-swap.
  - If there's no collision, it's a plain `UPDATE ... SET planned_date, day_of_week WHERE
    planned_date = fromDate AND session_type = sessionType`.
  - Guards server-side that the source row isn't `completed` (defense in depth — the UI
    already prevents opening the sheet for one).
  - Uses `BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK`, matching the existing pattern in
    `upsertHrZones`.
- **`deleteDailySession(conn, { plannedDate, sessionType })`** — `DELETE FROM
  training_plan_daily WHERE planned_date = ... AND session_type = ... AND NOT completed`.
- **Add** reuses the existing `upsertDailySession` — no new mutation needed.
- All three are followed by `syncWeeklyFromDaily(conn)` (refresh the week's rollup numbers)
  and `correlateActivitiesToPlan(conn)` (in case the new/moved slot now lines up with an
  already-logged activity), matching the existing CSV-import action's pattern.

**Server actions** — new `src/lib/planActions.ts` (`"use server"`), shared by both pages
rather than duplicated per route:

- `moveDailySessionAction(fromDate, sessionType, toDate)`
- `deleteDailySessionAction(plannedDate, sessionType)`
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
equivalent unit tests for `moveDailySession` (plain move, swap-on-collision, blocked-when-
target-completed) and `deleteDailySession` (blocked-when-completed) in the same style. The
edit sheet's UI is verified manually by running the dev server — adding component-rendering
infrastructure (jsdom + testing-library) solely for this feature would be disproportionate.
