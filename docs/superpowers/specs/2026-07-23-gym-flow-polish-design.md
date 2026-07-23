# Gym Flow Polish — Design

## Problem

Three related complaints about the live gym-logging flow (`web/src/app/gym/`):

1. **"Unknown exercise" bug.** `LiveSessionPanel` (`web/src/components/gym/LiveSessionPanel.tsx:20`)
   stores the whole selected `CachedExercise` object as React state. A custom exercise is cached
   under a negative placeholder `id` until its `create_exercise` mutation syncs
   (`web/src/lib/gymOffline/context.tsx:270-300`). Once sync completes,
   `web/src/lib/gymOffline/queue.ts:93-105` deletes the placeholder row from `exercisesCache` and
   reassigns any *already-logged* sets to the new real id — but the still-selected object in
   `LiveSessionPanel` isn't touched. If the user logs a set after sync finishes but before
   re-selecting, the new set is tagged with an id that's already gone from the cache. The lookup
   in `web/src/components/gym/ActiveSessionSets.tsx:24-27` then falls back to `"Unknown exercise"`.
   Sync can complete in well under the time it takes to select an exercise and type a weight/reps,
   so this isn't an edge case — it's the common path for any custom exercise logged while online.
2. **No obvious way to move to the next exercise.** `SetEntryForm` (`web/src/components/gym/SetEntryForm.tsx`)
   only has a small text "Change" link back to the exercise picker. There's no progress signal,
   no quick way to jump between exercises in a session, and no way to pre-load "what I'm doing
   today" — every exercise has to be searched/picked from scratch.
3. **General inconsistency.** Spacing, card boundaries, and button hierarchy vary across
   `ExercisePicker`, `SetEntryForm`, and `ActiveSessionSets` with no shared visual language.

Separately, the user wants a **recurring weekly plan** — pick which days you gym (e.g. Mon/Wed/Fri)
and which exercises go on each day — so starting a session on a plan day pre-loads that day's
exercises instead of starting from an empty picker every time.

## Scope

- Fix the stale-exercise-reference bug (root cause, not a symptom patch).
- Add a recurring weekly plan: day-of-week → ordered exercise list, editable via a new
  `/gym/plan` page, online-only editing, but usable offline once cached (a session started
  offline on a plan day still gets that day's exercises).
- Replace the single-exercise selection in the live session with a small ordered queue
  (chip-row UI, confirmed via visual mockup review), seeded from the day's plan when one exists,
  falling back to today's empty-picker behavior on days with no plan.
- Visual polish: consistent card containers, spacing, and button hierarchy across the session
  components. No new interactive widgets (no weight/rep steppers, no animation library) beyond
  what's described here.
- Out of scope: per-exercise target sets/reps/weight (a "program"), per-week plan variation
  (this is a single recurring template), offline plan *editing*, reordering days themselves
  (only exercises within a day), multi-user/plan-per-user (this app has no multi-tenancy anywhere
  and the plan is a single global template).

## Design

### 1. Bug fix: stable-key exercise selection

`LiveSessionPanel` stops storing a `CachedExercise` object as selection state. Instead it stores
a stable key — `exercise.client_uuid` if present (custom exercises, which keep the same
`client_uuid` across the placeholder→real-id sync), otherwise `String(exercise.id)` (library
exercises, whose id never changes) — and re-resolves the live object from the `exercises` array
on every render:

```ts
function keyFor(exercise: CachedExercise): string {
  return exercise.client_uuid ?? String(exercise.id);
}

function resolveByKey(exercises: CachedExercise[], key: string | null): CachedExercise | null {
  if (!key) return null;
  return exercises.find((e) => keyFor(e) === key) ?? null;
}
```

Once `queue.ts` reassigns a placeholder's id to the real one, the cached row's `client_uuid` is
unchanged (see `sendMutation`'s `create_exercise` case, which carries `client_uuid` through to the
replacement row) — so `resolveByKey` keeps resolving to the same logical exercise across the sync,
instead of to a row that's just been deleted. This same key scheme is reused for the session queue
below, so the bug can't resurface there either.

### 2. Weekly plan data model

New table, following the existing per-entity-table convention (`gym_exercises`/`gym_sessions`/`gym_sets`
in `web/src/lib/db/schema.ts`):

```sql
CREATE SEQUENCE IF NOT EXISTS gym_plan_exercises_id_seq START 1
CREATE TABLE IF NOT EXISTS gym_plan_exercises (
  id INTEGER PRIMARY KEY DEFAULT nextval('gym_plan_exercises_id_seq'),
  day_of_week INTEGER NOT NULL,   -- ISO: 1=Mon .. 7=Sun
  exercise_id INTEGER NOT NULL,
  position INTEGER NOT NULL,      -- display/queue order within the day
  created_at TIMESTAMP DEFAULT current_timestamp
)
```

Single global recurring template — no plan-owner column, matching every other table in this schema.
A day with zero rows is a rest day / has no plan. `web/src/lib/db/gymMutations.ts` gains:

- `getWeeklyPlan(conn): Promise<Record<number, GymExerciseRow[]>>` — one query joining
  `gym_plan_exercises` to `gym_exercises`, grouped by `day_of_week`, ordered by `position`.
- `setPlanForDay(conn, dayOfWeek, exerciseIds: number[]): Promise<void>` — delete-then-insert in a
  single transaction (`DELETE FROM gym_plan_exercises WHERE day_of_week = $day`, then one insert
  per id with its array index as `position`). Idempotent replace, same idiom as
  `upsertGymSession`'s replace-on-conflict, chosen over a diff/patch approach because a day's plan
  is always edited as a whole list (add/remove/reorder all go through the same builder screen).

### 3. Plan builder — `/gym/plan`

New page, linked from `/gym/page.tsx` the same way `/gym/insights` is today (`<a href="/gym/plan">`).
Confirmed via mockup review:

- A horizontal day-tab row (Mon..Sun), each tab showing an exercise count badge (e.g. "Mon · 4"),
  no badge for rest days.
- Below it, the selected day's exercises as a reorderable list (drag handle, remove per row) plus
  an "+ Add exercise to {Day}" button that opens the same search/muscle-group picker UI already
  used by `ExercisePicker`.
- Since this is online-only editing (confirmed), it uses plain Next.js server actions in
  `web/src/lib/gymActions.ts` (same pattern as `addCustomExerciseAction`), not the offline queue —
  `getWeeklyPlanAction()`, `setPlanForDayAction(dayOfWeek, exerciseIds)`. No offline queuing, no
  optimistic cache writes; a straightforward fetch-on-mount, mutate-then-refetch client component.
- Reordering is drag-and-drop reordering a plain array in local state before calling
  `setPlanForDayAction` with the full new order — no reason to introduce a drag library; a
  handful of rows (rarely more than 6-8 exercises/day) works fine with pointer-based
  up/down reordering (drag using native HTML5 drag events, no dependency).

### 4. Session queue (chip row)

Replaces `LiveSessionPanel`'s single `selectedExercise` state with a small queue, extracted into a
new `SessionExerciseQueue` component (keeps `LiveSessionPanel` focused on session lifecycle, not
exercise-selection mechanics — matches this codebase's existing pattern of small single-purpose
gym components).

- **State**: `queueKeys: string[]` (stable keys per §1) plus `currentKey: string | null`.
- **Seeding**: on `startSession`, compute JS `Date`'s ISO day-of-week for `sessionDate` and look up
  the cached `planByDay[dayOfWeek]` (see §5). If present, `queueKeys` seeds to those exercises' keys
  in order and `currentKey` is the first one. If absent (rest day / no plan for that day), `queueKeys`
  starts empty and the full `ExercisePicker` renders directly — picking an exercise pushes it as the
  first queue entry. This means plan-driven and ad-hoc sessions share one code path; there's no
  separate "no plan" mode to maintain.
- **Chips**: each `queueKeys` entry renders as a chip showing the resolved exercise's name, a ✓ if
  `activeSessionSets` has any set logged for it, and highlighted styling if it's `currentKey`.
  Tapping any chip sets `currentKey` to it — any order, not just forward. A trailing "+ Add" chip
  opens `ExercisePicker` in an inline panel; picking an exercise appends its key to `queueKeys` and
  sets it current (covers accessory work not on the plan).
- **Swap**: the current exercise's card gets a "Swap" action (replacing today's "Change" link) that
  opens `ExercisePicker` and replaces the entry at `currentKey`'s position in `queueKeys` with the
  newly picked exercise's key — for swapping out a planned exercise for this session only, without
  touching the saved plan.
- **Next**: once the current exercise has ≥1 logged set, a "Next exercise →" button appears
  alongside "Log set", advancing `currentKey` to the first `queueKeys` entry with zero logged sets;
  if none remain, it falls through to the "+ Add" picker. This is the main path for following a
  plan in order — the chip row exists for jumping around, not as the only way to advance.
- **End session** is unchanged — always available regardless of queue state.

### 5. Offline cache for the plan

`web/src/lib/gymOffline/db.ts` bumps `DB_VERSION` from 1 to 2 and adds a `planCache` store:

```ts
interface CachedPlanDay {
  dayOfWeek: number;       // 1=Mon..7=Sun
  exerciseIds: number[];   // in position order
}
// ...
planCache: { key: number; value: CachedPlanDay };
```

**Important migration detail**: the existing `upgrade(db)` callback in `db.ts:93-103` unconditionally
calls `createObjectStore` for all five current stores. Existing installs are already on version 1
with those stores created — bumping `DB_VERSION` triggers `upgrade` again for them, and an
unconditional `createObjectStore` call on a store that already exists throws. Each call must be
guarded:

```ts
if (!db.objectStoreNames.contains("exercisesCache")) db.createObjectStore("exercisesCache", { keyPath: "id" });
// ...same guard for every existing store, then unconditionally create planCache since it's new
```

`/api/gym/bootstrap` (`web/src/app/api/gym/bootstrap/route.ts`) gains a `planByDay` field
(`Record<number, number[]>`, from `getWeeklyPlan`, reshaped to just exercise ids per day since the
client already caches full exercise rows separately). `GymOfflineProvider`'s `bootstrap()`
(`context.tsx:115-132`) writes it into `planCache` via a new `replacePlanCache(db, entries)` helper,
same wholesale-replace pattern as `replaceExercisesCache`. `useGymOffline` exposes
`planByDay: Record<number, number[]>` read from `planCache` on `refresh()`, alongside the existing
`exercises`/`sessions`/`sets`.

### 6. Visual polish

Scoped to layout/consistency, not new widgets:

- Shared card container style (rounded border, consistent padding) applied to the current-exercise
  card, the chip row's wrapper, and the logged-sets list in `ActiveSessionSets` — currently these
  three have visibly different spacing/border treatment.
- Clear primary/secondary button hierarchy: "Log set" / "Next exercise →" are the only solid-filled
  buttons in the flow; "Swap", "Prev"-equivalent navigation (chip tap), and "Remove" stay as
  text-style secondary actions — matches the existing `bg-neutral-900` vs plain-text convention
  already used elsewhere in these components, just applied consistently.
- A CSS-only fade/transition (`transition-opacity`, no animation library) when `currentKey` changes,
  so switching exercises doesn't read as an abrupt reflow.

### 7. Production migration

New `web/scripts/add-gym-plan-table.ts`, self-contained (no local imports) per the existing
`add-gym-tables.ts` convention — duplicates the `CREATE SEQUENCE`/`CREATE TABLE` statements for
`gym_plan_exercises` rather than importing from `web/src/lib/db/schema.ts`, for the same
`moduleResolution: bundler` vs. plain-`node` import-extension conflict documented in
`add-gym-tables.ts`'s header. Run manually against MotherDuck before the app code deploys, same
gate as every prior gym-tracker migration.

## Error handling

- `setPlanForDayAction`: no exercise ids validated against `gym_exercises` beyond the existing FK-less
  convention already used by `gym_sets.exercise_id` (no FK constraint enforced anywhere in this
  schema) — an id that doesn't exist just won't join in `getWeeklyPlan` and silently drops from the
  displayed plan, consistent with how orphaned references already behave elsewhere in this app.
- If `planByDay` fetch fails during `bootstrap()` (offline first launch, no prior cache), `planCache`
  stays empty and every day behaves as a rest day — falls back to the exact current empty-picker
  behavior, not an error state.
- Session queue's `resolveByKey` returning `null` for a `currentKey` (e.g. a swapped-out custom
  exercise's placeholder that got deleted before being replaced in `queueKeys` — shouldn't happen
  given the swap flow replaces the key atomically, but as a safety net) falls back to rendering
  `ExercisePicker` rather than an empty card.

## Testing

- `keyFor`/`resolveByKey`: given a placeholder-id exercise reassigned to a real id in `exercises`,
  a key computed before reassignment still resolves to the (now-updated) row after.
- `setPlanForDay`: replacing a day's exercises drops removed ones and reflects new order; a
  different day's plan is untouched.
- `getWeeklyPlan`: rest days (no rows) are simply absent from the result map.
- IndexedDB migration: a v1 database (the five existing stores, some data in them) opened at v2
  gains `planCache` without erroring and without losing existing data in the other stores.
- Session queue seeding: a session started on a plan day seeds `queueKeys` in `position` order; a
  session started on a rest day starts with an empty queue and shows `ExercisePicker` first.
- Swap replaces the entry at the correct queue position without reordering the rest of the queue.
- Next-exercise advances to the first entry with zero logged sets, skipping already-logged ones,
  and falls through to "+ Add" when all entries are logged.
