# Cache Components Migration + App-Feel Motion — Design

## Problem

The user reported that switching bottom-nav tabs "seems slow, vs an authentic app where
they seem to snap to pages." Root-caused (see conversation) with a real server round-trip
test: every dashboard page takes ~230–700ms warm, ~3.5s cold, even though the underlying
query data is already `unstable_cache`-wrapped. Two compounding causes:

1. `web/src/app/(dashboard)/layout.tsx` is `export const dynamic = "force-dynamic"` (needed
   today to stop Next statically freezing DB-backed pages at build time). Per Next 16's own
   prefetching docs, a dynamic route with no `loading.tsx` gets **zero prefetch** — every tab
   click is a fully blocking, un-prefetched server round trip. Same problem on the three
   individually-`force-dynamic` gym pages (`gym/plan`, `gym/insights`, `gym/bodyweight`).
2. That layout's `getLastSynced()` call is **uncached**, unlike every query in `pageData.ts`.
   Isolated timing: ~200ms per call against MotherDuck even with a warm connection (~3.5s
   cold). It reruns on every single navigation for a value that only changes once per Strava
   sync.

Separately, the user wants the whole PWA to *feel* like a native app, not just respond
faster — motion (page transitions, loading-state handoffs) matters as much as latency.

## Scope

- Migrate the data/caching layer from `unstable_cache` + `force-dynamic` route segment
  configs to Next.js 16's Cache Components (`cacheComponents: true`, `'use cache'`,
  `cacheLife`, `cacheTag`) across the dashboard and gym read paths.
- Split the single `DASHBOARD_DATA_TAG` into three domain tags so a gym-set log doesn't
  invalidate (and force a re-fetch of) the running/nutrition dashboard, and vice versa.
- Add a motion layer using React's `<ViewTransition>` (Next 16's `experimental.viewTransition`)
  for tab crossfades and Suspense-reveal loading handoffs.
- Out of scope: rewriting the underlying SQL/metrics functions (they stay as-is, called from
  inside the new cached boundaries exactly as they're called from inside `unstable_cache`
  today); changing the Serwist service worker's NetworkFirst navigation strategy; per-sheet
  state-reset logic for `<Activity>` preservation (flagged as a verification item, not a
  preemptive fix — see Risks).

## Design

### 1. Enable Cache Components

`next.config.ts`:

```ts
const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    viewTransition: true,
  },
  // ...existing config (serverExternalPackages, headers) unchanged
};
```

This flips the caching model from opt-out (`force-dynamic` to escape accidental static
freezing) to opt-in (`'use cache'` wherever caching is wanted; everything else is dynamic
and streamed via Suspense automatically). Next prerenders a static shell per route and
streams dynamic/cached content in — the shell is what makes tabs instantly prefetchable.

Remove `export const dynamic = "force-dynamic"` from:
- `web/src/app/(dashboard)/layout.tsx`
- `web/src/app/gym/plan/page.tsx`
- `web/src/app/gym/insights/page.tsx`
- `web/src/app/gym/bodyweight/page.tsx`

`web/src/app/gym/layout.tsx` is unaffected (already not `force-dynamic`, by design, for
offline PWA support).

### 2. `pageData.ts`: `unstable_cache` → `'use cache'`

Each of the 8 exported functions changes from:

```ts
export const getTodayPageData = unstable_cache(
  async () => { /* ... */ },
  ["today-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);
```

to:

```ts
export async function getTodayPageData() {
  "use cache";
  cacheTag(TRAINING_DATA_TAG);
  /* ...identical body... */
}
```

Applies to: `getTodayPageData`, `getFatiguePageData`, `getTrainingLoadPageData`,
`getAerobicPageData`, `getPlanHistoryPageData`, `getRacePrepPageData` (all tagged
`TRAINING_DATA_TAG`), and `getGymInsightsPageData` (tagged `GYM_DATA_TAG`),
`getBodyWeightPageData` (tagged `BODYWEIGHT_DATA_TAG`). No `cacheLife()` call needed —
default profile is fine since these are tag-invalidated, not time-based (matches today's
"cache until next sync" behavior, no silent time-based staleness).

The internal query-layer files (`metrics.ts`, `gymMetrics.ts`, `mutations.ts`,
`gymMutations.ts`, `bodyWeightMutations.ts`) do **not** change — they take a `DuckDBConnection`
argument and are called from inside the outer cached function's body, same as they're called
from inside `unstable_cache`'s callback today.

### 3. Tag split

Three tags, all exported from `pageData.ts` as the single source of truth for tag names
(replacing the single `DASHBOARD_DATA_TAG`):

| Tag | Covers | Invalidated by |
|---|---|---|
| `TRAINING_DATA_TAG` | 6 `(dashboard)` pages, layout's `getLastSynced`, nutrition logs/targets, race events, daily plan sessions | Strava webhook sync route, `today/actions.ts`, `plan-history/actions.ts`, `planActions.ts`, `race-prep/actions.ts` |
| `GYM_DATA_TAG` | gym sets/sessions/exercises/plan, gym insights page | mutation actions in `gymActions.ts` (sets/sessions/exercises/plan) |
| `BODYWEIGHT_DATA_TAG` | body-weight logs + page | `logBodyWeightAction`, `deleteBodyWeightLogAction` |

Verified via code inspection that no page reads across domains (e.g. no training page
touches `gym_sessions`), so the split has no cross-tag staleness risk.

Every mutation action already calls `updateTag(DASHBOARD_DATA_TAG)` alongside
`revalidatePath(...)` — this is Cache Components' read-your-own-writes API, present today as
a no-op since nothing is `'use cache'`-tagged yet. Migration only needs to swap the tag name
each call site uses to whichever of the three domains applies; the call sites and
`revalidatePath` calls themselves don't need to change.

Also convert the currently-uncached reads in `gymActions.ts` — `getWeeklyPlanAction`,
`listGymExercisesAction`, `getExerciseProgressionAction`, `listBodyWeightLogsAction`,
`getGymSessionDetailAction` — to `'use cache'` + the appropriate tag, so they get the same
instant-repeat-visit treatment as the `pageData.ts` functions.

### 4. Layout's "last synced" freshness

Splitting the epoch fetch from the relative-time formatting avoids baking a frozen
"5m ago" into the static shell:

```tsx
// pageData.ts (or mutations.ts)
export async function getCachedLastSynced(): Promise<number | null> {
  "use cache";
  cacheTag(TRAINING_DATA_TAG);
  return getLastSynced(await getConnection());
}
```

```tsx
// (dashboard)/layout.tsx
import { connection } from "next/server";

async function LastSyncedLabel() {
  await connection(); // marks this subtree as genuinely per-request
  const lastSynced = await getCachedLastSynced();
  return <span>{lastSynced != null ? `Last synced ${formatLastSynced(lastSynced)}` : "Not synced yet"}</span>;
}

export default function DashboardLayout({ children }) {
  return (
    <div className="...">
      <div className="...">
        <Suspense fallback={<span>…</span>}>
          <LastSyncedLabel />
        </Suspense>
        <SyncButton />
      </div>
      <main>{children}</main>
      <BottomNav />
    </div>
  );
}
```

The epoch value is cached and tag-invalidated same as everything else; `formatLastSynced`'s
`Date.now()`-based string is computed fresh on every request via the `connection()` +
`Suspense` boundary, never frozen into the prerendered shell.

### 5. `loading.tsx` skeletons

Even with Cache Components' automatic streaming, an explicit `loading.tsx` per route group
gives an immediate, intentional skeleton rather than relying on default Suspense boundaries.
Add one under `web/src/app/(dashboard)/loading.tsx` (shared by all 6 tabs) and one each for
`gym/plan`, `gym/insights`, `gym/bodyweight`. Skeletons match each page's rough shape (stat
cards + chart placeholders) rather than a generic spinner, consistent with the existing
`StatCard`/`ChartCard` visual language.

### 6. Motion layer (`<ViewTransition>`)

- Bottom-nav tab switches: wrap each route group's main content in
  `<ViewTransition name="tab-content" share="auto" enter="auto" default="none">` — a
  **crossfade**, not a directional slide, since bottom-nav tabs are peer views in a
  persistent shell, not a drill-down hierarchy.
- Suspense fallback → content handoff: asymmetric slide-down (exit, ~150ms) / slide-up
  (enter, ~210ms, delayed until exit completes) per the Next.js view-transitions guide,
  applied to the `loading.tsx` → page-content handoff.
- `BottomNav` and the layout header get `viewTransitionName` anchoring
  (`::view-transition-group(...) { animation: none }`) so they never participate in any
  transition — they're already outside the transitioning region, but explicit anchoring
  prevents any flash.
- `@media (prefers-reduced-motion: reduce)` zeroes all view-transition animation durations.
- Progressive enhancement: unsupported Safari versions simply skip the animation (per
  React's `<ViewTransition>` behavior) — no fallback code needed, confirmed as acceptable
  (per user decision).

## Risks / things to verify during implementation, not preemptively fix

- **`<Activity>`-based state preservation.** Cache Components keeps recently-visited routes
  mounted-but-hidden (via React's `<Activity>`) instead of unmounting on navigation, so
  component state (open sheets, scroll position, form inputs) persists across tab switches.
  Several components are bottom-sheet-style (`GymSessionDetailSheet`, `LogFuelingSheet`,
  `EditSessionSheet`, `WorkoutDetailSheet`). This is mostly desirable for "feels like an
  app," but needs manual verification post-implementation rather than guessing which sheets
  need reset logic ahead of time.
- **`generateStaticParams` / dynamic routes**: none of the affected routes are dynamic
  segments (`[id]`-style), so the "must return at least one param" Cache Components rule
  doesn't apply here.
- **`cookies()`/`headers()` usage**: only `app/login/actions.ts` reads `cookies()`, inside a
  Server Action (unaffected by Cache Components' static-shell rules — Server Actions always
  run per-invocation). No page component reads runtime request data directly, so no
  additional `<Suspense>` wrapping is needed beyond the `LastSyncedLabel` case above.
- **`runtime = 'edge'`**: not used anywhere; the app already requires the Node.js runtime
  for native DuckDB bindings, which Cache Components also requires.

## Testing

- Existing Vitest suites for `metrics.ts`/`gymMetrics.ts`/mutation files are unaffected
  (unchanged function signatures).
- Add/update tests around the tag split: mutating gym data invalidates `GYM_DATA_TAG` reads
  without invalidating `TRAINING_DATA_TAG` reads, and vice versa.
- Manual verification (dev server, as in the earlier debugging session): re-run the
  before/after curl timing comparison per dashboard route to confirm the cold/warm latency
  drop, and a real-device check on the user's iPhone/Safari for the view-transition motion
  and `<Activity>`-preserved sheet behavior.
