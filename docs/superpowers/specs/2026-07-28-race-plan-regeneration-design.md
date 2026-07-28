# Race-Aware Plan Regeneration — Design

## Problem

Race Prep's "Add race" form (`web/src/app/(dashboard)/race-prep/page.tsx`,
`web/src/app/(dashboard)/race-prep/actions.ts`) saves a race into `race_events` and stops there.
It does not adjust the training plan at all — a known, documented gap
(`web/SETUP.md`, "Known gaps vs. the Streamlit version"). The legacy Streamlit app's "Save &
rebuild plan" button called `build_plan()` (`src/periodization.py`, repo root, Python — never
ported to the Next.js app) to regenerate the periodized weekly plan around the race calendar.

That old engine isn't safe to just wire back in as-is. Reading it closely surfaced real
injury/overtraining gaps, plus one outright data-loss bug:

1. **Destructive rebuild.** `build_plan` runs `DELETE FROM training_plan_daily` / `training_plan`
   / `training_blocks` with no `WHERE` clause, then only re-inserts weeks from the current
   Monday forward. Every historical week's plan row is permanently deleted on every rebuild.
2. **Flat one-week taper/recovery for every race**, regardless of distance or priority — a 90km
   ultra and a 10km tune-up get identical single-week windows.
3. **First-write-wins race-window conflicts.** If two races fall close together, the second
   race's taper or recovery window can silently be dropped instead of both being honored.
4. **No global ramp-rate cap.** Only the `base` phase caps growth (5%/week); `build` linearly
   interpolates to peak km over however many weeks remain, with no ceiling — a late-added race
   that compresses the runway to the goal race can silently produce a much steeper week-over-week
   jump than is safe.
5. **Flat fitness estimate.** Current fitness is a single 28-day running-volume average, with no
   acute:chronic load signal and no rebound guard after a forced recovery week.

This design replaces `build_plan` with a TypeScript engine, ported into `web/`, that fixes all
five of these while adding a pre-save preview so a race can be added without silently producing
an unsafe plan.

## Scope

- Regenerating the plan when a race is **added** via the existing Race Prep form. (Editing or
  deleting an existing race is not covered by this design — same regeneration engine would
  apply, but that's a follow-up.)
- Only **future, not-yet-elapsed weeks** (this week's Monday onward) are ever recomputed or
  written. Weeks before that are never touched, full stop — this fixes gap #1 above.
- Full recompute of the future window on every add: every future week is recalculated from the
  block-type/ramp rules, not patched incrementally. Any manual CSV-import edits to future weeks
  are superseded when a race is added — CSV import remains a way to seed/adjust the plan, not an
  append-only overlay this engine must reconcile against.
- The plan horizon stays exactly as it is today: generated weeks run from now through the
  **primary goal race** (nearest upcoming A-priority `race_events` row — already computed
  elsewhere in the app via `getPrimaryGoalRace`, replacing the old hardcoded `comrades_idx`/
  `COMRADES_DATE`). A race added *after* the current primary goal race is saved and shown in the
  UI but does not extend the generated horizon — out of scope here.
- Peak-volume ceiling (`_PEAK_KM = 110`) and the base-phase fitness ramp are carried over
  unchanged. Generalizing the target-volume model itself to arbitrary goal-race distances is a
  separate concern from safely inserting a race into an existing lead-up.
- Daily session templates, descriptions, and the hills/tempo/intervals quality rotation are
  ported essentially unchanged from `src/periodization.py`'s `_TEMPLATES`/`_DESCRIPTIONS`/
  `_QUALITY_ROTATION`, with one bug fix (below).

## Data flow: two-step preview, no drafts

The engine is one pure function (`web/src/lib/plan/engine.ts`), callable identically for a
dry-run preview and for the real write — no draft rows, no client-side state:

```
computeTrainingPlan(input: {
  today: Date,
  raceEvents: RaceEvent[],       // current DB rows, plus the candidate race merged in for preview
  lastKnownWeeklyKm: number,     // last pre-horizon week's planned volume, or the fitness estimate
}) => {
  weeks: PlanWeek[],
  dailySessions: PlanDailySession[],
  warnings: PlanWarning[],       // ramp-cap clamps + race-window overlaps
}
```

1. **Add race form submits** (`web/src/app/(dashboard)/race-prep/page.tsx`, unchanged markup) →
   `addRaceEvent` (`actions.ts`) validates the fields exactly as today, but no longer writes to
   the DB. It redirects to `/race-prep/preview` with the candidate race's fields as query
   params.
2. **Preview page** (`web/src/app/(dashboard)/race-prep/preview/page.tsx`, new server component)
   reads those params, loads the current `race_events` + last-known weekly volume from the DB,
   and calls `computeTrainingPlan` read-only with the candidate race merged into the race list.
   Renders:
   - A week-by-week table of every week whose phase or volume would change (old vs. new).
   - The warnings list (ramp clamps, race-window overlaps), each naming the specific weeks/races
     involved.
   - **Confirm & Save** — a form carrying the same race fields as hidden inputs, submitting to
     `confirmAddRaceEvent`.
   - **Cancel** — a plain link back to `/race-prep`. Nothing was ever written, so cancelling is
     just navigating away.
3. **Confirm submits** → `confirmAddRaceEvent` (`actions.ts`, new) re-validates the hidden
   fields, then in one transaction: inserts the race into `race_events`, re-runs
   `computeTrainingPlan` against the now-current DB state, deletes only `training_plan`/
   `training_plan_daily` rows with `planned_date`/`week_start_date >=` this week's Monday, inserts
   the freshly computed future weeks/sessions, commits. Revalidates and redirects to
   `/race-prep`.

Running the same pure function twice (preview, then confirm) gives identical output unless
something else changed the DB in between (e.g. a Strava sync landing mid-preview) — an accepted
non-issue for a single-user local app, not silently ignored.

## Core algorithm

**Block types** (`web/src/lib/plan/blockTypes.ts`): same phase structure as the original — `base`
(first 6 non-race weeks) → 4-week `build`/`deload` cycles → `peak` (9 weeks before the anchor) →
`taper` (3 weeks before the anchor) → `race` (anchor week) — but anchored to the primary goal
race instead of a hardcoded date.

**Race windows** (`web/src/lib/plan/raceWindows.ts`): for every upcoming race (not just the
anchor), taper (before) and recovery (after) window length comes from distance bands, applied
symmetrically:

| Distance      | Window |
|---------------|--------|
| < 21km        | 0 weeks |
| 21–42km       | 1 week |
| 42–70km       | 2 weeks |
| 70km+         | 3 weeks |

Depth within the window uses one formula instead of per-length tables — for a window of length
`W`, the week `k` weeks out from the race (`k=1` = closest) gets:

```
factor(k) = D + (1 - D) * (k - 1) / W
```

`D` is the priority depth: **A-priority `D = 0.55`, B-priority `D = 0.75`** (midpoints of "taper/
recover to ~50–60%/~70–80% of that week's block-type target"). E.g. a 70km+ A-priority race
(`W=3`) steps **0.55 → 0.70 → 0.85** from closest to furthest week; a 42–70km B-priority race
(`W=2`) steps **0.75 → 0.875**. Recovery uses the same shape, counting weeks after the race
instead of before it.

**Conflict merge.** Every race's window claims a set of `(week → factor)` pairs. These are
merged into one map across all races; where a week is claimed more than once, the engine takes
`min(factors)` (the more conservative load) and attaches a warning naming both races and dates.

**Ramp cap** (`web/src/lib/plan/rampCap.ts`): after block-type + race-window factors produce a
raw target per week, walk the weeks chronologically with a running `prevWeekKm` seeded from
`lastKnownWeeklyKm`:

- Week **not** flagged taper/recovery/deload/race: `target = min(target, prevWeekKm * 1.10)`;
  record a warning if clamped.
- Week **is** one of those flagged types: never clamped — a drop is expected there.
- Either way, `prevWeekKm` becomes that week's final (possibly clamped) value for the next
  iteration.

Chaining the cap off the actual previous value (rather than resetting after a flagged week) means
the week immediately after a recovery/taper dip is capped relative to that lower number too — the
plan can't snap back to full volume the week right after a recovery week. The original engine had
no such rebound guard; this closes gap #4 and #5 above without needing an explicit ACWR
calculation.

**Daily sessions** (`web/src/lib/plan/dailySessions.ts`): ported from `_TEMPLATES`/
`_DESCRIPTIONS`/`_QUALITY_ROTATION`/long-run-35%-cap essentially unchanged. One fix: race-taper
template selection currently always falls back to `race_taper_B` regardless of the actual race's
priority (a TODO left in the original — `template_key = "race_taper_B"  # default; priority passed
separately if needed`); this will correctly pick `race_taper_A` vs. `_B` from whichever race owns
that window.

## Error handling

- Preview route reached with missing/invalid query params (direct navigation, stale bookmark,
  tampering): re-run the same validation as the Add-race form; redirect back to `/race-prep`
  rather than rendering a broken preview.
- `computeTrainingPlan` throwing during preview (e.g. a transient DB read failure) is caught at
  the route level and rendered as an error state with a link back to `/race-prep` — nothing was
  written, so there's nothing to roll back.
- `confirmAddRaceEvent`'s race-insert + delete-future + insert-future all happen in one
  transaction; any failure rolls back the whole thing, so the race is never saved with a
  half-regenerated plan (or vice versa).
- Warnings (ramp clamps, race-window overlaps) are informational, never blocking — Confirm always
  succeeds if the DB write itself succeeds.

## Testing

Vitest unit tests (matching the existing `metrics.test.ts` style: in-memory DuckDB, `node`
environment):

- Block-type assignment across anchor-race positions, including the anchor itself changing when
  a new, nearer A-priority race is added.
- Ramp-cap clamping: no non-exempt week exceeds 110% of the prior week's *final* volume; the
  rebound week after a recovery/taper dip stays capped too.
- Taper/recovery depth formula across all four distance bands × both priorities.
- Conflict merge: two overlapping windows produce the `min` factor and a warning naming both
  races.
- Regression test for the original data-loss bug: seed a plan week dated before `today`, run
  compute + persist, assert that row is unchanged afterward.
- One fixture-based test: fixed `today` + anchor race + 2–3 additional races → snapshot the full
  `computeTrainingPlan` output (weeks, sessions, warnings).

The edit/preview UI itself is verified manually via the dev server, matching how UI-only changes
are handled elsewhere in this project (no component-rendering test infrastructure exists yet).
