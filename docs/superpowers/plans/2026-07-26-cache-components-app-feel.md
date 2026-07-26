# Cache Components Migration + App-Feel Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bottom-nav tab switching feel instant (prefetched, no blocking round-trip) and make navigation feel like a native app (crossfade transitions, animated loading handoffs), by migrating the data layer from `unstable_cache`/`force-dynamic` to Next.js 16 Cache Components and layering React's `<ViewTransition>` on top.

**Architecture:** Enable `cacheComponents: true` in `next.config.ts`, which flips caching from opt-out (`force-dynamic` route configs) to opt-in (`'use cache'` + `cacheTag` at the function level) and lets Next prerender a static per-route shell that streams dynamic content in via Suspense. Split the single cache tag into three domain tags (training/gym/bodyweight) so mutations in one domain don't force cache misses in another. Layer `experimental.viewTransition` on top for native crossfade/reveal animations.

**Tech Stack:** Next.js 16.2.10 (App Router, Cache Components, `<ViewTransition>`), React (canary features via Next), TypeScript, Vitest, MotherDuck (DuckDB), Tailwind CSS.

## Global Constraints

- Requires Next.js 16's Cache Components (`cacheComponents: true`) — already on Next 16.2.10, no version bump needed.
- Every route in this app already requires the Node.js runtime (native DuckDB bindings) — Cache Components also requires Node.js, so no conflict.
- Cache invalidation stays tag-based ("cache until the next sync/mutation"), never time-based (`cacheLife` with a `revalidate` window) — matches today's `unstable_cache` behavior, don't introduce silent staleness.
- View Transitions are progressive enhancement only — no Safari-version feature-detection code; unsupported browsers just get an instant swap (React's own fallback behavior).
- Don't touch `web/src/app/sw.ts`'s NetworkFirst navigation strategy — out of scope.
- Don't preemptively add state-reset logic to sheet/dialog components (`GymSessionDetailSheet`, `LogFuelingSheet`, `EditSessionSheet`, `WorkoutDetailSheet`) for `<Activity>`-based state preservation — flag for manual verification in Task 11, only fix if something is actually observed broken.

---

## Task 1: Enable Cache Components and View Transitions

**Files:**
- Modify: `web/next.config.ts`

**Interfaces:**
- Produces: `cacheComponents: true` and `experimental.viewTransition: true` config flags that every subsequent task depends on (later tasks' `'use cache'`/`cacheTag`/`<ViewTransition>` usage only works once these are set).

- [ ] **Step 1: Add the config flags**

Current file:

```ts
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  // Native bindings — must be require()'d at runtime, not webpack-bundled.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
});

export default withSerwist(nextConfig);
```

Replace the `nextConfig` object with:

```ts
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    viewTransition: true,
  },
  // Native bindings — must be require()'d at runtime, not webpack-bundled.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
});

export default withSerwist(nextConfig);
```

- [ ] **Step 2: Verify the dev server boots and surfaces expected errors**

Run: `cd web && npm run dev`

Expected: server starts. Because every page still has `force-dynamic` and `unstable_cache` (not yet migrated), you will likely see Cache Components errors/warnings in the terminal the moment a page is requested (e.g. "Route ... used `force-dynamic`... " or uncached-data errors) — that's expected until Task 2 onward land. Confirm the process starts without a hard config-parse crash, then stop it (`Ctrl+C`).

- [ ] **Step 3: Commit**

```bash
cd web && git add next.config.ts && git commit -m "feat: enable Next 16 Cache Components and View Transitions"
```

---

## Task 2: Migrate `pageData.ts` to `'use cache'` with a three-way tag split

**Files:**
- Modify: `web/src/lib/pageData.ts`

**Interfaces:**
- Consumes: nothing new (same `getConnection`, `queryRow`, metric/mutation functions as before).
- Produces: `TRAINING_DATA_TAG`, `GYM_DATA_TAG`, `BODYWEIGHT_DATA_TAG` (string constants, replacing the old `DASHBOARD_DATA_TAG` export — every other task that referenced `DASHBOARD_DATA_TAG` is updated in Tasks 3–4), plus `getCachedLastSynced(): Promise<number | null>`. All 8 existing page-data functions (`getTodayPageData`, `getFatiguePageData`, `getTrainingLoadPageData`, `getAerobicPageData`, `getPlanHistoryPageData`, `getRacePrepPageData`, `getGymInsightsPageData`, `getBodyWeightPageData`) keep their exact names and zero-argument call signatures — no consumer changes needed.

- [ ] **Step 1: Update imports and replace the tag constant**

Old:

```ts
import { unstable_cache } from "next/cache";
import { getConnection, queryRow } from "./db/client";
```

New:

```ts
import { cacheTag } from "next/cache";
import { getConnection, queryRow } from "./db/client";
```

Old:

```ts
export const DASHBOARD_DATA_TAG = "dashboard-data";
```

New:

```ts
export const TRAINING_DATA_TAG = "training-data";
export const GYM_DATA_TAG = "gym-data";
export const BODYWEIGHT_DATA_TAG = "bodyweight-data";
```

- [ ] **Step 2: Add `getCachedLastSynced`**

Add this function right after the tag constants (before `rollingAvg`):

```ts
import { getLastSynced } from "./db/mutations";

export async function getCachedLastSynced(): Promise<number | null> {
  "use cache";
  cacheTag(TRAINING_DATA_TAG);
  return getLastSynced(await getConnection());
}
```

(Add `getLastSynced` to the existing `import { getAllRaceEvents, getPrimaryGoalRace } from "./db/mutations";` line instead of a separate import — final line reads:
`import { getAllRaceEvents, getLastSynced, getPrimaryGoalRace } from "./db/mutations";`)

- [ ] **Step 3: Convert `getTodayPageData`**

Old wrapper (opening and closing lines — body between them is unchanged):

```ts
export const getTodayPageData = unstable_cache(
  async () => {
    const conn = await getConnection();
```

...(unchanged body)...

```ts
      milestones,
      readiness,
    };
  },
  ["today-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);
```

New:

```ts
export async function getTodayPageData() {
  "use cache";
  cacheTag(TRAINING_DATA_TAG);
  const conn = await getConnection();
```

...(unchanged body, both `return` sites inside stay as-is)...

```ts
      milestones,
      readiness,
    };
  }
}
```

Note: the original body has two `return` statements (the early-return for `weekSummary.length === 0`, and the final return). Both stay exactly as they are; only the outer wrapper (first 3 lines and last 4 lines) changes. The function body keeps its original indentation (harmless whitespace-only inconsistency, not a lint failure — this project's ESLint config has no indentation rule) — reindenting is optional and not required for this task to be complete.

- [ ] **Step 4: Convert the remaining 7 functions the same way**

Apply the identical transformation (delete the `unstable_cache(`/arrow-function opening, insert `"use cache"; cacheTag(...);` as the new function's first two statements, delete the closing `}, [...], { tags: [...] });` and replace with a single closing `}`) to:

| Function | Old closing key-parts array | Tag to use |
|---|---|---|
| `getFatiguePageData` | `["fatigue-page-data"]` | `TRAINING_DATA_TAG` |
| `getTrainingLoadPageData` | `["training-load-page-data"]` | `TRAINING_DATA_TAG` |
| `getAerobicPageData` | `["aerobic-page-data"]` | `TRAINING_DATA_TAG` |
| `getPlanHistoryPageData` | `["plan-history-page-data"]` | `TRAINING_DATA_TAG` |
| `getRacePrepPageData` | `["race-prep-page-data"]` | `TRAINING_DATA_TAG` |
| `getGymInsightsPageData` | `["gym-insights-page-data"]` | `GYM_DATA_TAG` |
| `getBodyWeightPageData` | `["body-weight-page-data"]` | `BODYWEIGHT_DATA_TAG` |

For example, `getGymInsightsPageData` goes from:

```ts
export const getGymInsightsPageData = unstable_cache(
  async () => {
    const conn = await getConnection();
```
...
```ts
      defaultProgression,
    };
  },
  ["gym-insights-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);
```

to:

```ts
export async function getGymInsightsPageData() {
  "use cache";
  cacheTag(GYM_DATA_TAG);
  const conn = await getConnection();
```
...
```ts
      defaultProgression,
    };
  }
}
```

- [ ] **Step 5: Typecheck and run the existing test suite**

Run: `cd web && npx tsc --noEmit && npm test`

Expected: no type errors from `pageData.ts` (it has no dedicated test file — `metrics.test.ts`/`gymMetrics.test.ts`/etc. test the lower-level functions it calls, unaffected by this change) — the full suite should pass exactly as before.

- [ ] **Step 6: Commit**

```bash
cd web && git add src/lib/pageData.ts && git commit -m "feat: migrate pageData.ts to Cache Components with a 3-way tag split"
```

---

## Task 3: Repoint training-domain actions and the webhook route at `TRAINING_DATA_TAG`

**Files:**
- Modify: `web/src/app/(dashboard)/today/actions.ts`
- Modify: `web/src/app/(dashboard)/plan-history/actions.ts`
- Modify: `web/src/lib/planActions.ts`
- Modify: `web/src/app/(dashboard)/race-prep/actions.ts`
- Modify: `web/src/lib/syncActions.ts`
- Modify: `web/src/app/api/webhook/strava/route.ts`
- Modify: `web/src/lib/workoutActions.ts` (added post-hoc — missed in the original file list; `logNiggleAction` invalidates the tag `getFatiguePageData`'s `recentNiggleLogs` reads, which is training-domain data)

**Interfaces:**
- Consumes: `TRAINING_DATA_TAG` from `@/lib/pageData` (Task 2).
- Produces: no new exports — these files' own exported action/route functions keep identical signatures.

- [ ] **Step 1: `today/actions.ts`**

Old:

```ts
import { DASHBOARD_DATA_TAG } from "@/lib/pageData";
```
```ts
function revalidateNutrition(): void {
  updateTag(DASHBOARD_DATA_TAG);
  revalidatePath("/today");
}
```

New:

```ts
import { TRAINING_DATA_TAG } from "@/lib/pageData";
```
```ts
function revalidateNutrition(): void {
  updateTag(TRAINING_DATA_TAG);
  revalidatePath("/today");
}
```

- [ ] **Step 2: `plan-history/actions.ts`**

Old:

```ts
import { DASHBOARD_DATA_TAG } from "@/lib/pageData";
```
```ts
  updateTag(DASHBOARD_DATA_TAG);
  revalidatePath("/plan-history");
  revalidatePath("/today");
  return { success: `Replaced plan with ${rows.length} sessions and matched to Strava activities.` };
```

New:

```ts
import { TRAINING_DATA_TAG } from "@/lib/pageData";
```
```ts
  updateTag(TRAINING_DATA_TAG);
  revalidatePath("/plan-history");
  revalidatePath("/today");
  return { success: `Replaced plan with ${rows.length} sessions and matched to Strava activities.` };
```

- [ ] **Step 3: `src/lib/planActions.ts`**

Old:

```ts
import { DASHBOARD_DATA_TAG } from "./pageData";
```
```ts
function revalidatePlanPages(): void {
  updateTag(DASHBOARD_DATA_TAG);
  revalidatePath("/today");
  revalidatePath("/plan-history");
}
```

New:

```ts
import { TRAINING_DATA_TAG } from "./pageData";
```
```ts
function revalidatePlanPages(): void {
  updateTag(TRAINING_DATA_TAG);
  revalidatePath("/today");
  revalidatePath("/plan-history");
}
```

- [ ] **Step 4: `race-prep/actions.ts`**

Old:

```ts
import { DASHBOARD_DATA_TAG } from "@/lib/pageData";
```
```ts
  updateTag(DASHBOARD_DATA_TAG);
  revalidatePath("/race-prep");
```

New:

```ts
import { TRAINING_DATA_TAG } from "@/lib/pageData";
```
```ts
  updateTag(TRAINING_DATA_TAG);
  revalidatePath("/race-prep");
```

- [ ] **Step 5: `src/lib/syncActions.ts`**

Old:

```ts
import { DASHBOARD_DATA_TAG } from "./pageData";
```
```ts
      await runSync(conn);
      revalidateTag(DASHBOARD_DATA_TAG, { expire: 0 });
```

New:

```ts
import { TRAINING_DATA_TAG } from "./pageData";
```
```ts
      await runSync(conn);
      revalidateTag(TRAINING_DATA_TAG, { expire: 0 });
```

- [ ] **Step 6: `src/app/api/webhook/strava/route.ts`**

Old:

```ts
import { DASHBOARD_DATA_TAG } from "@/lib/pageData";
```
```ts
        await runSync(conn);
        // Only invalidate the dashboard's cached data once sync actually
        // succeeds — a failed sync shouldn't force every page to re-query
        // MotherDuck for data that hasn't changed. `{ expire: 0 }` forces
        // immediate expiration (next request blocks on fresh data) rather
        // than the default `'max'` stale-while-revalidate profile, which
        // would serve one more stale page load before refreshing.
        revalidateTag(DASHBOARD_DATA_TAG, { expire: 0 });
```

New:

```ts
import { TRAINING_DATA_TAG } from "@/lib/pageData";
```
```ts
        await runSync(conn);
        // Only invalidate the dashboard's cached data once sync actually
        // succeeds — a failed sync shouldn't force every page to re-query
        // MotherDuck for data that hasn't changed. `{ expire: 0 }` forces
        // immediate expiration (next request blocks on fresh data) rather
        // than the default `'max'` stale-while-revalidate profile, which
        // would serve one more stale page load before refreshing.
        revalidateTag(TRAINING_DATA_TAG, { expire: 0 });
```

- [ ] **Step 6b: `src/lib/workoutActions.ts`**

Old:

```ts
import { DASHBOARD_DATA_TAG } from "./pageData";
```
```ts
  // Fatigue page's recent-niggles summary reads cached page data, unlike
  // this sheet's own fetch (re-invoked directly by the client on success).
  updateTag(DASHBOARD_DATA_TAG);
  return {};
```

New:

```ts
import { TRAINING_DATA_TAG } from "./pageData";
```
```ts
  // Fatigue page's recent-niggles summary reads cached page data, unlike
  // this sheet's own fetch (re-invoked directly by the client on success).
  updateTag(TRAINING_DATA_TAG);
  return {};
```

- [ ] **Step 7: Typecheck**

Run: `cd web && npx tsc --noEmit`

Expected: no errors (in particular, no lingering `DASHBOARD_DATA_TAG` import — it no longer exists in `pageData.ts` after Task 2, so any file still importing it would now fail to compile, confirming full coverage).

Run: `cd web && grep -rn "DASHBOARD_DATA_TAG" src` — expected: no matches anywhere in `src/`.

- [ ] **Step 8: Commit**

```bash
cd web && git add src/app/\(dashboard\)/today/actions.ts src/app/\(dashboard\)/plan-history/actions.ts src/lib/planActions.ts src/app/\(dashboard\)/race-prep/actions.ts src/lib/syncActions.ts src/app/api/webhook/strava/route.ts && git commit -m "feat: repoint training-domain cache invalidation at TRAINING_DATA_TAG"
```

---

## Task 4: Migrate `gymActions.ts` reads to `'use cache'` with gym/bodyweight tag split

**Files:**
- Modify: `web/src/lib/gymActions.ts`

**Interfaces:**
- Consumes: `GYM_DATA_TAG`, `BODYWEIGHT_DATA_TAG` from `@/lib/pageData` (Task 2, note this file uses the relative import `./pageData`).
- Produces: same exported function names/signatures as before (`getGymSessionDetailAction`, `listGymExercisesAction`, `getExerciseProgressionAction`, `getWeeklyPlanAction`, `listBodyWeightLogsAction` become cached; the mutation actions keep their signatures, only their `updateTag(...)` argument changes).

- [ ] **Step 1: Update the import**

Old:

```ts
import { updateTag } from "next/cache";
```
```ts
import { DASHBOARD_DATA_TAG } from "./pageData";
```

New:

```ts
import { cacheTag, updateTag } from "next/cache";
```
```ts
import { BODYWEIGHT_DATA_TAG, GYM_DATA_TAG } from "./pageData";
```

- [ ] **Step 2: Cache the gym read functions**

Old:

```ts
export async function getGymSessionDetailAction(sessionId: number): Promise<GymSessionDetail | null> {
  const conn = await getConnection();
  return getGymSessionDetail(conn, sessionId);
}

export async function listGymExercisesAction(): Promise<GymExerciseRow[]> {
  const conn = await getConnection();
  return listGymExercises(conn);
}

// Backs the /gym/insights exercise-progression select for any exercise not
// already preloaded in getGymInsightsPageData's default.
export async function getExerciseProgressionAction(exerciseId: number): Promise<ExerciseProgressionRow[]> {
  const conn = await getConnection();
  return exerciseProgression(conn, exerciseId);
}
```

New:

```ts
export async function getGymSessionDetailAction(sessionId: number): Promise<GymSessionDetail | null> {
  "use cache";
  cacheTag(GYM_DATA_TAG);
  const conn = await getConnection();
  return getGymSessionDetail(conn, sessionId);
}

export async function listGymExercisesAction(): Promise<GymExerciseRow[]> {
  "use cache";
  cacheTag(GYM_DATA_TAG);
  const conn = await getConnection();
  return listGymExercises(conn);
}

// Backs the /gym/insights exercise-progression select for any exercise not
// already preloaded in getGymInsightsPageData's default.
export async function getExerciseProgressionAction(exerciseId: number): Promise<ExerciseProgressionRow[]> {
  "use cache";
  cacheTag(GYM_DATA_TAG);
  const conn = await getConnection();
  return exerciseProgression(conn, exerciseId);
}
```

- [ ] **Step 3: Update the gym mutation actions' tag**

Old (5 call sites — `logGymSetAction`, `deleteGymSetAction`, `deleteGymSessionAction`, `updateGymSessionNotesAction`, `createGymSessionForActivityAction`):

```ts
  updateTag(DASHBOARD_DATA_TAG);
```

New (all 5 sites):

```ts
  updateTag(GYM_DATA_TAG);
```

(These are the exact same statement repeated at lines 78, 85, 91, 97, and 137 of the original file — replace every occurrence in the gym-domain functions, i.e. everything **above** `getWeeklyPlanAction`/`setPlanForDayAction`/the body-weight functions below.)

- [ ] **Step 4: Cache `getWeeklyPlanAction`**

Old:

```ts
export async function getWeeklyPlanAction(): Promise<Record<string, PlanExerciseRow[]>> {
  const conn = await getConnection();
  return getWeeklyPlan(conn);
}
```

New:

```ts
export async function getWeeklyPlanAction(): Promise<Record<string, PlanExerciseRow[]>> {
  "use cache";
  cacheTag(GYM_DATA_TAG);
  const conn = await getConnection();
  return getWeeklyPlan(conn);
}
```

Also add `updateTag(GYM_DATA_TAG);` to `setPlanForDayAction` (currently the only gym mutation in the file with no invalidation call at all — this was already a latent bug where the plan-builder relied on the page's own `force-dynamic` freshness instead of cache invalidation; now that gym pages get cached, it needs one):

Old:

```ts
export async function setPlanForDayAction(dayOfWeek: string, entries: PlanEntryInput[]): Promise<void> {
  const conn = await getConnection();
  await setPlanForDay(conn, dayOfWeek, entries);
}
```

New:

```ts
export async function setPlanForDayAction(dayOfWeek: string, entries: PlanEntryInput[]): Promise<void> {
  const conn = await getConnection();
  await setPlanForDay(conn, dayOfWeek, entries);
  updateTag(GYM_DATA_TAG);
}
```

- [ ] **Step 5: Cache the body-weight read functions and repoint their tag**

Old:

```ts
export async function logBodyWeightAction(formData: FormData): Promise<GymActionState> {
  const loggedDate = String(formData.get("logged_date") ?? "");
  const weightKg = Number(formData.get("weight_kg"));

  if (!loggedDate) return { error: "Pick a date." };
  if (!Number.isFinite(weightKg) || weightKg <= 0) return { error: "Enter a valid weight." };

  const conn = await getConnection();
  await logBodyWeight(conn, {
    client_uuid: crypto.randomUUID(),
    logged_date: loggedDate,
    weight_kg: weightKg,
  });

  updateTag(DASHBOARD_DATA_TAG);
  return {};
}

export async function listBodyWeightLogsAction(): Promise<BodyWeightLogRow[]> {
  const conn = await getConnection();
  return listBodyWeightLogs(conn);
}

export async function deleteBodyWeightLogAction(clientUuid: string): Promise<void> {
  const conn = await getConnection();
  await deleteBodyWeightLog(conn, clientUuid);
  updateTag(DASHBOARD_DATA_TAG);
}
```

New:

```ts
export async function logBodyWeightAction(formData: FormData): Promise<GymActionState> {
  const loggedDate = String(formData.get("logged_date") ?? "");
  const weightKg = Number(formData.get("weight_kg"));

  if (!loggedDate) return { error: "Pick a date." };
  if (!Number.isFinite(weightKg) || weightKg <= 0) return { error: "Enter a valid weight." };

  const conn = await getConnection();
  await logBodyWeight(conn, {
    client_uuid: crypto.randomUUID(),
    logged_date: loggedDate,
    weight_kg: weightKg,
  });

  updateTag(BODYWEIGHT_DATA_TAG);
  return {};
}

export async function listBodyWeightLogsAction(): Promise<BodyWeightLogRow[]> {
  "use cache";
  cacheTag(BODYWEIGHT_DATA_TAG);
  const conn = await getConnection();
  return listBodyWeightLogs(conn);
}

export async function deleteBodyWeightLogAction(clientUuid: string): Promise<void> {
  const conn = await getConnection();
  await deleteBodyWeightLog(conn, clientUuid);
  updateTag(BODYWEIGHT_DATA_TAG);
}
```

- [ ] **Step 6: Typecheck and test**

Run: `cd web && npx tsc --noEmit && npm test`

Expected: passes. No test file directly covers `gymActions.ts` (it's a thin Server Action wrapper around `gymMutations.ts`/`bodyWeightMutations.ts`, which are unaffected).

- [ ] **Step 7: Commit**

```bash
cd web && git add src/lib/gymActions.ts && git commit -m "feat: migrate gymActions.ts reads to Cache Components, split gym/bodyweight tags"
```

---

## Task 5: Remove `force-dynamic` from the dashboard layout and stream "last synced" dynamically

**Files:**
- Modify: `web/src/app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `getCachedLastSynced` from `@/lib/pageData` (Task 2).
- Produces: no exports change (default export is still the layout component), but it's no longer `async` — the async data fetch moves into the new inline `LastSyncedLabel` component.

- [ ] **Step 1: Replace the file contents**

Old (full file):

```tsx
import { BottomNav } from "@/components/BottomNav";
import { SyncButton } from "@/components/SyncButton";
import { getConnection } from "@/lib/db/client";
import { getLastSynced } from "@/lib/db/mutations";

// Without this, Next statically prerenders these pages at build time (no
// cookies/headers/searchParams access triggers the auto-static heuristic),
// freezing the dashboard's DB-backed data until the next deploy.
export const dynamic = "force-dynamic";

function formatLastSynced(epochSeconds: number): string {
  const diffMin = Math.round((Date.now() - epochSeconds * 1000) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const lastSynced = await getLastSynced(await getConnection());

  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-2 px-4 pt-2 text-right text-xs text-neutral-400">
        <span>{lastSynced != null ? `Last synced ${formatLastSynced(lastSynced)}` : "Not synced yet"}</span>
        <span aria-hidden="true">·</span>
        <SyncButton />
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-2">{children}</main>
      <BottomNav />
    </div>
  );
}
```

New (full file):

```tsx
import { Suspense } from "react";
import { connection } from "next/server";
import { BottomNav } from "@/components/BottomNav";
import { SyncButton } from "@/components/SyncButton";
import { getCachedLastSynced } from "@/lib/pageData";

function formatLastSynced(epochSeconds: number): string {
  const diffMin = Math.round((Date.now() - epochSeconds * 1000) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

// The epoch timestamp is cached (getCachedLastSynced), but the relative-time
// string is computed from Date.now() at request time — connection() marks
// this subtree as genuinely per-request so the string never gets frozen
// into the prerendered static shell (see Task 5 in the implementation plan
// for why: without it, "5m ago" would stay fixed until the next sync
// invalidates the cache, which can be hours later).
async function LastSyncedLabel() {
  await connection();
  const lastSynced = await getCachedLastSynced();
  return <span>{lastSynced != null ? `Last synced ${formatLastSynced(lastSynced)}` : "Not synced yet"}</span>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-2 px-4 pt-2 text-right text-xs text-neutral-400">
        <Suspense fallback={<span>Checking sync status…</span>}>
          <LastSyncedLabel />
        </Suspense>
        <span aria-hidden="true">·</span>
        <SyncButton />
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-2">{children}</main>
      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd web && git add src/app/\(dashboard\)/layout.tsx && git commit -m "feat: remove force-dynamic from dashboard layout, stream last-synced label"
```

---

## Task 6: Remove `force-dynamic` from the three gym pages

**Files:**
- Modify: `web/src/app/gym/plan/page.tsx`
- Modify: `web/src/app/gym/insights/page.tsx`
- Modify: `web/src/app/gym/bodyweight/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no changes to any exported component signature — purely deletes the now-unnecessary route segment config comment+export from each file.

- [ ] **Step 1: `gym/plan/page.tsx`**

Old:

```tsx
import Link from "next/link";
import { getWeeklyPlanAction, listGymExercisesAction } from "@/lib/gymActions";
import { PlanBuilder } from "@/components/gym/PlanBuilder";

// This page (unlike the /gym shell) doesn't need offline support — plan
// editing is online-only by design — so it can opt into per-request
// freshness independently of that route's static shell. See
// web/src/app/gym/layout.tsx's header comment for why the shell itself
// stays static.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```

New:

```tsx
import Link from "next/link";
import { getWeeklyPlanAction, listGymExercisesAction } from "@/lib/gymActions";
import { PlanBuilder } from "@/components/gym/PlanBuilder";

export const runtime = "nodejs";
```

- [ ] **Step 2: `gym/insights/page.tsx`**

Old:

```tsx
import Link from "next/link";
import { getGymInsightsPageData } from "@/lib/pageData";
import { StatCard } from "@/components/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import { MuscleGroupVolumeChart, SessionsPerWeekChart, VolumeByWeekChart } from "@/components/charts/GymCharts";
import { ExerciseProgressionSection } from "@/components/gym/ExerciseProgressionSection";

// This page (unlike the /gym shell) doesn't need offline support, so it can
// opt into per-request freshness independently of that route's static shell
// — see web/src/app/gym/layout.tsx's header comment for why the shell itself
// stays static.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```

New:

```tsx
import Link from "next/link";
import { getGymInsightsPageData } from "@/lib/pageData";
import { StatCard } from "@/components/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import { MuscleGroupVolumeChart, SessionsPerWeekChart, VolumeByWeekChart } from "@/components/charts/GymCharts";
import { ExerciseProgressionSection } from "@/components/gym/ExerciseProgressionSection";

export const runtime = "nodejs";
```

- [ ] **Step 3: `gym/bodyweight/page.tsx`**

Old:

```tsx
import Link from "next/link";
import { getBodyWeightPageData } from "@/lib/pageData";
import { todayIso } from "@/lib/shared";
import { BodyWeightPage } from "@/components/gym/BodyWeightPage";

// This page (like /gym/plan) doesn't need offline support — logging bodyweight
// isn't a live-at-the-gym-mid-workout action, it can be done anytime with
// connectivity — so it can opt into per-request freshness independently of
// the /gym shell's static route. See web/src/app/gym/layout.tsx's header
// comment for why the shell itself stays static.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```

New:

```tsx
import Link from "next/link";
import { getBodyWeightPageData } from "@/lib/pageData";
import { todayIso } from "@/lib/shared";
import { BodyWeightPage } from "@/components/gym/BodyWeightPage";

export const runtime = "nodejs";
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`

Expected: no errors. Run `grep -rn "force-dynamic" web/src` — expected: no matches anywhere.

- [ ] **Step 5: Commit**

```bash
cd web && git add src/app/gym/plan/page.tsx src/app/gym/insights/page.tsx src/app/gym/bodyweight/page.tsx && git commit -m "feat: remove force-dynamic from gym plan/insights/bodyweight pages"
```

---

## Task 7: Add `loading.tsx` skeletons

**Files:**
- Create: `web/src/app/(dashboard)/loading.tsx`
- Create: `web/src/app/gym/plan/loading.tsx`
- Create: `web/src/app/gym/insights/loading.tsx`
- Create: `web/src/app/gym/bodyweight/loading.tsx`

**Interfaces:**
- Consumes: nothing (pure presentational components, no data fetching).
- Produces: default-exported React components matching Next's `loading.tsx` file convention — no props.

- [ ] **Step 1: Dashboard shared skeleton**

Create `web/src/app/(dashboard)/loading.tsx`:

```tsx
function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800 ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <SkeletonBlock className="h-6 w-40" />
      <div className="grid grid-cols-2 gap-2">
        <SkeletonBlock className="h-16" />
        <SkeletonBlock className="h-16" />
      </div>
      <SkeletonBlock className="h-48 w-full" />
      <SkeletonBlock className="h-48 w-full" />
    </div>
  );
}
```

- [ ] **Step 2: Gym plan skeleton**

Create `web/src/app/gym/plan/loading.tsx`:

```tsx
function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800 ${className}`} />;
}

export default function GymPlanLoading() {
  return (
    <div className="space-y-4">
      <SkeletonBlock className="h-6 w-48" />
      <SkeletonBlock className="h-4 w-full" />
      <SkeletonBlock className="h-64 w-full" />
    </div>
  );
}
```

- [ ] **Step 3: Gym insights skeleton**

Create `web/src/app/gym/insights/loading.tsx`:

```tsx
function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800 ${className}`} />;
}

export default function GymInsightsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonBlock className="h-6 w-32" />
      <div className="grid grid-cols-2 gap-2">
        <SkeletonBlock className="h-16" />
        <SkeletonBlock className="h-16" />
      </div>
      <SkeletonBlock className="h-40 w-full" />
      <SkeletonBlock className="h-40 w-full" />
    </div>
  );
}
```

- [ ] **Step 4: Gym bodyweight skeleton**

Create `web/src/app/gym/bodyweight/loading.tsx`:

```tsx
function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800 ${className}`} />;
}

export default function GymBodyWeightLoading() {
  return (
    <div className="space-y-4">
      <SkeletonBlock className="h-6 w-32" />
      <SkeletonBlock className="h-40 w-full" />
      <SkeletonBlock className="h-64 w-full" />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd web && git add "src/app/(dashboard)/loading.tsx" src/app/gym/plan/loading.tsx src/app/gym/insights/loading.tsx src/app/gym/bodyweight/loading.tsx && git commit -m "feat: add loading skeletons for dashboard and gym routes"
```

---

## Task 7b: Remove `export const runtime = "nodejs"` everywhere (Cache Components incompatibility)

**Discovered during Task 8's dev-server verification, not anticipated by the original spec.** With `cacheComponents: true` enabled, Next.js 16 rejects the `runtime` route segment config outright — on ANY value, not just `"edge"` — with a hard build/runtime error: `Route segment config "runtime" is not compatible with nextConfig.cacheComponents. Please remove it.` This affects every page and Route Handler in the app that declares `export const runtime = "nodejs";`, which is all of them (the app requires Node.js for native DuckDB bindings) — so every single route 500'd once Task 1's config landed and none of the subsequent tasks removed this now-incompatible declaration (it wasn't in scope for any of Tasks 1-7 as written). Node.js is simply the unconditional default runtime under Cache Components (there is no edge option), so the fix is to delete the line outright, not replace it with anything.

**Files:**
- Modify (delete the `export const runtime = "nodejs";` line and the blank line immediately after it, leaving surrounding code otherwise untouched):
  - `web/src/app/(dashboard)/today/page.tsx`
  - `web/src/app/(dashboard)/fatigue/page.tsx`
  - `web/src/app/(dashboard)/aerobic/page.tsx`
  - `web/src/app/(dashboard)/training-load/page.tsx`
  - `web/src/app/(dashboard)/plan-history/page.tsx`
  - `web/src/app/(dashboard)/race-prep/page.tsx`
  - `web/src/app/gym/plan/page.tsx`
  - `web/src/app/gym/insights/page.tsx`
  - `web/src/app/gym/bodyweight/page.tsx`
  - `web/src/app/api/gym/bootstrap/route.ts`
  - `web/src/app/api/gym/sessions/route.ts`
  - `web/src/app/api/webhook/strava/route.ts`
  - `web/src/app/api/gym/exercises/route.ts`
  - `web/src/app/api/gym/sets/[clientUuid]/route.ts`
  - `web/src/app/api/gym/sets/route.ts`

**Interfaces:** no exports change in any of these 15 files — purely deletes one now-invalid line (plus its trailing blank line) per file.

- [ ] **Step 1: Delete the line in all 15 files**

Every occurrence is a bare two-line block with no attached comment (verified directly in each file):

```ts
export const runtime = "nodejs";

```

Delete both the `export const runtime = "nodejs";` line and the blank line that immediately follows it in each of the 15 files, leaving the surrounding imports/code otherwise untouched.

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Start the dev server and confirm every route returns 200, not 500**

```bash
cd web
pkill -f "next dev" 2>/dev/null; sleep 1
(SESSION_SECRET="local-smoke-test-secret" SITE_PASSWORD="localtest" nohup npm run dev > /tmp/nextdev-taskfix.log 2>&1 & echo $! > /tmp/nextdev-taskfix.pid)
sleep 5 && tail -20 /tmp/nextdev-taskfix.log
TOKEN=$(node -e '
const crypto = require("crypto");
console.log(crypto.createHmac("sha256", "local-smoke-test-secret").update("authenticated").digest("hex"));
')
COOKIE="session=$TOKEN"
for p in today fatigue training-load aerobic plan-history race-prep gym/plan gym/insights gym/bodyweight; do
  curl -s -o /dev/null -w "/$p -> %{http_code}\n" -H "Cookie: $COOKIE" "http://localhost:3000/$p"
done
pkill -f "next dev"
```

Expected: every route returns `200`, not `500`. No "not compatible with `nextConfig.cacheComponents`" errors in the log.

Run: `grep -rn "export const runtime" web/src` — expected: zero matches anywhere (this route segment config is fully retired under Cache Components).

- [ ] **Step 4: Run the full test suite**

Run: `cd web && npm test`

Expected: same 222 tests passing (no test exercises route segment configs directly).

- [ ] **Step 5: Commit**

```bash
cd web && git add -A && git commit -m "fix: remove runtime segment config, incompatible with Cache Components"
```

---

## Task 7c: Fix `new Date()`/`Date.now()` prerender errors on Fatigue and Body Weight pages

**Discovered during Task 7b's dev-server verification.** With `export const runtime = "nodejs"` removed (Task 7b) and `force-dynamic` removed (Tasks 5/6), Next now attempts to prerender a static shell for every page — including `FatiguePage` and `GymBodyWeightPage`, which both call `todayIso()` (`web/src/lib/shared.ts:82`, `return new Date().toISOString().slice(0, 10);`) directly in the component body, before any request-data access. This trips Next's dynamicIO validation: `Route "/fatigue" used new Date() before accessing either uncached data... or Request data...`. The HTTP response still returns 200 in dev (the error surfaces from a background prerender pass, not the actual dynamic render), but this would very likely fail at `next build` time, when Next actually needs to produce a static shell.

Note: `todayIso()` is *also* called in 4 places inside `web/src/lib/pageData.ts` (inside `getTodayPageData`, `getFatiguePageData`, `getRacePrepPageData`, `getPlanHistoryPageData`) — those call sites are inside `'use cache'` functions and are unaffected/out of scope here: the "computed once, reused until the next tag invalidation" behavior for those is pre-existing (unchanged from when they were `unstable_cache`-wrapped before this migration), not a new bug.

`fatigue/page.tsx` also has a second, closely related direct call: `fourWeeksAgoMs()` (line 30-32) calls `Date.now()` directly, with a comment claiming this route is `force-dynamic` (no longer true after Task 5). This call sits *after* `todayIso()` in the render body, so it wasn't independently flagged by Task 7b's dev-server run (Next's dynamicIO check reports the first violation; a component-wide fix that satisfies the requirement before `todayIso()` also covers this later call, since dynamicIO's rule is "no current-time access *before* request data is accessed," not "no current-time access at all").

**Fix:** these two pages compute a "today" value throughout render (`FatiguePage` uses it across ACWR/monotony calculations feeding several `StatCard`s; `GymBodyWeightPage` passes it straight through as a prop) — narrowly Suspense-isolating just the date computation the way Task 5 did for the "last synced" label would require extracting most of each page's body into a child component, disproportionate to the problem. The correct minimal fix is to call Next's `connection()` API as the first statement in each page's async function body, before any other work — this marks the *entire* page as genuinely per-request dynamic (same freshness guarantee these two pages had under their old `force-dynamic` config), while their data-fetching (`getFatiguePageData()`, `getBodyWeightPageData()`) keeps the speed benefit of being `'use cache'`-tagged (fast on a cache hit; only the shell-prefetch benefit is intentionally not gained for these 2 of 9 tabs). This is a deliberate, bounded tradeoff, not an oversight — call it out as such rather than silently prerendering the whole page.

**Files:**
- Modify: `web/src/app/(dashboard)/fatigue/page.tsx`
- Modify: `web/src/app/gym/bodyweight/page.tsx`

**Interfaces:** no exports change — both pages' default export signatures are unchanged.

- [ ] **Step 1: `fatigue/page.tsx`**

Old (top of file):

```tsx
import { getFatiguePageData } from "@/lib/pageData";
import { firstNonNull, flag, latestCompleteDay, todayIso, type TrainingStatus } from "@/lib/shared";
import { StatCard } from "@/components/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import {
  AcwrChart,
  EfficiencyFactorChart,
  MonotonyChart,
  RampRateChart,
  StrainChart,
  TsbChart,
} from "@/components/charts/FatigueCharts";
```
...
```tsx
// Isolated from the component body: this is a per-request Server Component
// (force-dynamic), so wall-clock time here is intentional, not a purity bug —
// factoring it out just satisfies the linter's static "no Date.now() in
// render" check, which can't see that this route never gets prerendered.
function fourWeeksAgoMs(): number {
  return Date.now() - 28 * 86400000;
}

export default async function FatiguePage() {
  const { tsb, ef, acwr, ramp, mono, longPct, b2b, paceTrend, niggles, vo2max, trainingStatus } = await getFatiguePageData();
```

New:

```tsx
import { connection } from "next/server";
import { getFatiguePageData } from "@/lib/pageData";
import { firstNonNull, flag, latestCompleteDay, todayIso, type TrainingStatus } from "@/lib/shared";
import { StatCard } from "@/components/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import {
  AcwrChart,
  EfficiencyFactorChart,
  MonotonyChart,
  RampRateChart,
  StrainChart,
  TsbChart,
} from "@/components/charts/FatigueCharts";
```
...
```tsx
// Wall-clock time (todayIso/fourWeeksAgoMs below) needs this whole page to
// be genuinely per-request — connection() marks it as such under Cache
// Components, trading this page's static-shell prefetch for correctness
// (the alternative, force-dynamic, no longer exists as a concept).
function fourWeeksAgoMs(): number {
  return Date.now() - 28 * 86400000;
}

export default async function FatiguePage() {
  await connection();
  const { tsb, ef, acwr, ramp, mono, longPct, b2b, paceTrend, niggles, vo2max, trainingStatus } = await getFatiguePageData();
```

- [ ] **Step 2: `gym/bodyweight/page.tsx`**

Old (full file):

```tsx
import Link from "next/link";
import { getBodyWeightPageData } from "@/lib/pageData";
import { todayIso } from "@/lib/shared";
import { BodyWeightPage } from "@/components/gym/BodyWeightPage";

export default async function GymBodyWeightPage() {
  const { logs, chartData } = await getBodyWeightPageData();
  const today = todayIso();

  return (
    <div>
      <Link href="/gym" className="text-xs text-neutral-500 underline">
        ← Gym
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Body Weight</h1>
      <p className="mt-1 text-sm text-neutral-500">Log your body weight and track it over time.</p>
      <div className="mt-4">
        <BodyWeightPage initialLogs={logs} initialChartData={chartData} today={today} />
      </div>
    </div>
  );
}
```

New (full file):

```tsx
import Link from "next/link";
import { connection } from "next/server";
import { getBodyWeightPageData } from "@/lib/pageData";
import { todayIso } from "@/lib/shared";
import { BodyWeightPage } from "@/components/gym/BodyWeightPage";

export default async function GymBodyWeightPage() {
  await connection();
  const { logs, chartData } = await getBodyWeightPageData();
  const today = todayIso();

  return (
    <div>
      <Link href="/gym" className="text-xs text-neutral-500 underline">
        ← Gym
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Body Weight</h1>
      <p className="mt-1 text-sm text-neutral-500">Log your body weight and track it over time.</p>
      <div className="mt-4">
        <BodyWeightPage initialLogs={logs} initialChartData={chartData} today={today} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Verify the dynamicIO error is gone and a production build succeeds**

```bash
cd web
pkill -f "next dev" 2>/dev/null; sleep 1
(SESSION_SECRET="local-smoke-test-secret" SITE_PASSWORD="localtest" nohup npm run dev > /tmp/nextdev-7c.log 2>&1 & echo $! > /tmp/nextdev-7c.pid)
sleep 5
TOKEN=$(node -e '
const crypto = require("crypto");
console.log(crypto.createHmac("sha256", "local-smoke-test-secret").update("authenticated").digest("hex"));
')
COOKIE="session=$TOKEN"
curl -s -o /dev/null -w "/fatigue -> %{http_code}\n" -H "Cookie: $COOKIE" "http://localhost:3000/fatigue"
curl -s -o /dev/null -w "/gym/bodyweight -> %{http_code}\n" -H "Cookie: $COOKIE" "http://localhost:3000/gym/bodyweight"
grep -i "new Date()\|not compatible" /tmp/nextdev-7c.log || echo "no dynamicIO/cacheComponents errors found"
pkill -f "next dev"
```

Expected: both routes return 200, and the grep finds nothing (the "no dynamicIO/cacheComponents errors found" fallback prints).

Then run a real production build, since this class of error is a build-time concern first and foremost:

```bash
cd web && npm run build
```

Expected: build succeeds. If it fails with a similar current-time/dynamic-access error on a *different* page than these two, that indicates another call site this task's scope didn't anticipate — stop and report it rather than guessing at a fix.

- [ ] **Step 5: Run the full test suite**

Run: `cd web && npm test`

Expected: same 222 tests passing.

- [ ] **Step 6: Commit**

```bash
cd web && git add "src/app/(dashboard)/fatigue/page.tsx" src/app/gym/bodyweight/page.tsx && git commit -m "fix: mark Fatigue and Body Weight pages as per-request dynamic via connection()"
```

---

## Task 7d: Wrap `/login`'s `searchParams` read in `<Suspense>` (blocking-route build failure)

**Discovered during Task 7c's production-build verification.** `npm run build` fails on `/login`:

```
Error: Route "/login": Uncached data was accessed outside of <Suspense>. This delays the
entire page from rendering, resulting in a slow user experience.
```

`web/src/app/login/page.tsx` reads `searchParams` (a `Promise<{ from?: string; error?: string }>`) directly at the top of `LoginPage`'s body, with no enclosing `<Suspense>` boundary. This is unrelated to `new Date()`/current-time (Task 7c's bug) — it's the "runtime request data needs a Suspense boundary" rule described in Next's Cache Components migration guide for `searchParams`/`cookies()`/`headers()`. Confirmed pre-existing (not a regression from any task in this plan): `git log --oneline -- src/app/login/page.tsx` shows only the original repo's Next.js rewrite commit, and Task 7c's implementer verified via a stashed-baseline build that this page was never reached by `next build` before now — the build previously exited earlier, at `/fatigue`'s error, before ever getting far enough to prerender `/login`.

**Fix:** move the `searchParams`-dependent rendering into a small async child component wrapped in `<Suspense>`, mirroring the pattern already used for the dashboard layout's "last synced" label (Task 5) — a static shell (title, password field, submit button) renders immediately; only the two `searchParams`-dependent pieces (the hidden `from` field's value, and the conditional "Incorrect password" message) stream in via the child component.

**Files:**
- Modify: `web/src/app/login/page.tsx`

**Interfaces:** no exports change — `LoginPage` keeps its default export and `{ searchParams }` prop signature (Next's file convention requires this).

- [ ] **Step 1: Replace the file contents**

Old (full file):

```tsx
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from = "/", error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form action={login} className="w-full max-w-xs space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <input type="hidden" name="from" value={from} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          required
          autoFocus
          className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {error && <p className="text-sm text-red-600">Incorrect password.</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
```

New (full file):

```tsx
import { Suspense } from "react";
import { login } from "./actions";

async function LoginForm({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from = "/", error } = await searchParams;

  return (
    <form action={login} className="w-full max-w-xs space-y-4">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <input type="hidden" name="from" value={from} />
      <input
        type="password"
        name="password"
        placeholder="Password"
        required
        autoFocus
        className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
      />
      {error && <p className="text-sm text-red-600">Incorrect password.</p>}
      <button
        type="submit"
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        Sign in
      </button>
    </form>
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Production build**

Run: `cd web && npm run build`

Expected: build succeeds end-to-end. This is the definitive check for this task — if it still fails on `/login` or fails anywhere else, stop and report rather than guessing at further changes.

- [ ] **Step 4: Manual login smoke-test on the dev server**

```bash
cd web
pkill -f "next dev" 2>/dev/null; sleep 1
(SESSION_SECRET="local-smoke-test-secret" SITE_PASSWORD="localtest" nohup npm run dev > /tmp/nextdev-7d.log 2>&1 & echo $! > /tmp/nextdev-7d.pid)
sleep 5
curl -s -o /dev/null -w "/login -> %{http_code}\n" "http://localhost:3000/login"
curl -s -o /dev/null -w "/login?error=1 -> %{http_code}\n" "http://localhost:3000/login?error=1"
pkill -f "next dev"
```

Expected: both return 200. (A full interactive login flow re-check isn't necessary here — `login.actions.ts`'s server action logic is untouched by this task; only the page's rendering structure changed.)

- [ ] **Step 5: Run the full test suite**

Run: `cd web && npm test`

Expected: same 222 tests passing.

- [ ] **Step 6: Commit**

```bash
cd web && git add src/app/login/page.tsx && git commit -m "fix: wrap /login's searchParams read in Suspense (Cache Components blocking-route)"
```

---

## Task 8: Verify latency and cache-tag isolation on the dev server

**Files:**
- None (verification-only task; no source changes).

**Interfaces:**
- Consumes: the running dev server from Tasks 1–7.
- Produces: a pass/fail confirmation that later tasks (motion layer) can build on top of, plus a written note of the before/after timing in the task's own commit message (no code commit, but a log entry keeps the record with the work).

- [ ] **Step 1: Start the dev server with local auth overrides**

This repo's `.env` has blank `SESSION_SECRET`/`SITE_PASSWORD` for local dev (see `web/src/lib/auth.ts`) — override them inline for this session only, don't edit `.env`:

```bash
cd web
pkill -f "next dev" 2>/dev/null; sleep 1
(SESSION_SECRET="local-smoke-test-secret" SITE_PASSWORD="localtest" nohup npm run dev > /tmp/nextdev.log 2>&1 & echo $! > /tmp/nextdev.pid)
sleep 5 && tail -30 /tmp/nextdev.log
```

Expected: `✓ Ready in ...ms` with no Cache Components errors (if any route still triggers a "used dynamic/uncached data without Suspense" error, that means one of Tasks 2–6 was missed for that route — go back and check before continuing).

- [ ] **Step 2: Compute the session cookie and time each dashboard/gym route**

```bash
cd web
TOKEN=$(node -e '
const crypto = require("crypto");
console.log(crypto.createHmac("sha256", "local-smoke-test-secret").update("authenticated").digest("hex"));
')
COOKIE="session=$TOKEN"

for p in today fatigue training-load aerobic plan-history race-prep gym/plan gym/insights gym/bodyweight; do
  curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: $COOKIE" "http://localhost:3000/$p" > /dev/null
done

echo "=== timed navigations (post-compile) ==="
for i in 1 2; do
  for p in today fatigue training-load aerobic plan-history race-prep gym/plan gym/insights gym/bodyweight; do
    T=$(curl -s -o /dev/null -w "%{time_total}" -H "Cookie: $COOKIE" "http://localhost:3000/$p")
    echo "/$p -> ${T}s"
  done
done
```

Expected: every route's second-round timing should be **at or below** the pre-migration baseline captured earlier in this project's debugging session (~230–700ms per route). Any route still showing multi-second warm latency means its `'use cache'` conversion (Task 2 or 4) didn't take — re-check that file.

- [ ] **Step 3: Verify cross-tag isolation**

Log a body-weight entry (mutates only `BODYWEIGHT_DATA_TAG`), then confirm a `TRAINING_DATA_TAG` page's timing is unaffected (still fast/cached, not forced to re-hit MotherDuck):

```bash
cd web
TOKEN=$(node -e '
const crypto = require("crypto");
console.log(crypto.createHmac("sha256", "local-smoke-test-secret").update("authenticated").digest("hex"));
')
COOKIE="session=$TOKEN"

# Baseline: /today warm timing before the bodyweight mutation
curl -s -o /dev/null -w "today before: %{time_total}s\n" -H "Cookie: $COOKIE" "http://localhost:3000/today"

# Trigger a body-weight log via the gym bodyweight page's server action isn't
# curl-able directly (it's a form POST tied to a server action reference) —
# instead confirm isolation the other way: hit /gym/bodyweight to prime its
# cache, then hit /today again and confirm timing is unaffected (proves they
# don't share a cache bucket that either read would have invalidated).
curl -s -o /dev/null -w "gym/bodyweight: %{time_total}s\n" -H "Cookie: $COOKIE" "http://localhost:3000/gym/bodyweight"
curl -s -o /dev/null -w "today after: %{time_total}s\n" -H "Cookie: $COOKIE" "http://localhost:3000/today"
```

Expected: `today before` and `today after` are both fast (cache hit, roughly equal timing) — visiting the bodyweight route doesn't force `/today` to recompute.

- [ ] **Step 4: Stop the dev server**

```bash
pkill -f "next dev"
```

No commit for this task (verification-only) — if any check fails, return to the relevant task above, fix it, and re-run this task's steps before proceeding to Task 9.

---

## Task 9: Add View Transition CSS

**Files:**
- Modify: `web/src/app/globals.css`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS classes (`tab-crossfade`, `suspense-reveal`) and named view-transition groups (`site-header`, `bottom-nav`) that Task 10 references from JSX via `<ViewTransition name="..." share="...">` and `style={{ viewTransitionName: "..." }}`.

- [ ] **Step 1: Append the view-transition rules**

Add to the end of `web/src/app/globals.css`:

```css
/* View Transitions: bottom-nav tab crossfade + suspense-reveal handoff.
   Progressive enhancement — browsers without View Transitions support just
   swap instantly, no fallback code needed. */

::view-transition-group(.tab-crossfade) {
  animation-duration: 180ms;
}

::view-transition-old(.suspense-reveal) {
  animation:
    150ms ease-out both fade reverse,
    150ms ease-out both slide-y reverse;
}
::view-transition-new(.suspense-reveal) {
  animation:
    210ms ease-in 150ms both fade,
    400ms ease-in-out both slide-y;
}

@keyframes fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes slide-y {
  from {
    transform: translateY(10px);
  }
  to {
    transform: translateY(0);
  }
}

/* Header and bottom nav are outside the transitioning region already, but
   anchor them explicitly so no browser ever flashes a duplicate during a
   transition. */
::view-transition-group(site-header),
::view-transition-group(bottom-nav) {
  animation: none;
  z-index: 100;
}
::view-transition-old(site-header),
::view-transition-old(bottom-nav) {
  display: none;
}
::view-transition-new(site-header),
::view-transition-new(bottom-nav) {
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*),
  ::view-transition-new(*),
  ::view-transition-group(*) {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd web && git add src/app/globals.css && git commit -m "feat: add view-transition CSS for tab crossfade and suspense reveal"
```

---

## Task 10: Wire `<ViewTransition>` into the dashboard and gym layouts

**Files:**
- Modify: `web/src/app/(dashboard)/layout.tsx`
- Modify: `web/src/app/gym/layout.tsx`
- Modify: `web/src/components/BottomNav.tsx`

**Interfaces:**
- Consumes: the `tab-crossfade`/`site-header`/`bottom-nav` CSS from Task 9.
- Produces: no new exports — same default-exported layout/component signatures as before.

- [ ] **Step 1: Wrap `(dashboard)/layout.tsx`'s main content**

Starting from Task 5's version of this file, change the imports and the `<main>` wrapping:

Old:

```tsx
import { Suspense } from "react";
import { connection } from "next/server";
import { BottomNav } from "@/components/BottomNav";
import { SyncButton } from "@/components/SyncButton";
import { getCachedLastSynced } from "@/lib/pageData";
```
...
```tsx
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-2 px-4 pt-2 text-right text-xs text-neutral-400">
        <Suspense fallback={<span>Checking sync status…</span>}>
          <LastSyncedLabel />
        </Suspense>
        <span aria-hidden="true">·</span>
        <SyncButton />
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-2">{children}</main>
      <BottomNav />
    </div>
  );
}
```

New:

```tsx
import { Suspense, ViewTransition } from "react";
import { connection } from "next/server";
import { BottomNav } from "@/components/BottomNav";
import { SyncButton } from "@/components/SyncButton";
import { getCachedLastSynced } from "@/lib/pageData";
```
...
```tsx
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <div
        style={{ viewTransitionName: "site-header" }}
        className="mx-auto flex w-full max-w-3xl items-center justify-end gap-2 px-4 pt-2 text-right text-xs text-neutral-400"
      >
        <Suspense fallback={<span>Checking sync status…</span>}>
          <LastSyncedLabel />
        </Suspense>
        <span aria-hidden="true">·</span>
        <SyncButton />
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-2">
        <ViewTransition name="tab-content" share="tab-crossfade" enter="auto" default="none">
          {children}
        </ViewTransition>
      </main>
      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 2: Wrap `gym/layout.tsx`'s main content**

Old:

```tsx
import { BottomNav } from "@/components/BottomNav";
import { GymOfflineProvider } from "@/lib/gymOffline/context";
import { GymStatusHeader } from "@/components/gym/GymStatusHeader";

// Deliberately NOT under (dashboard) and NOT force-dynamic: that layout does
// a DB call on every request, which combined with BottomNav's plain-<a>
// full-page navigations means a cold PWA launch straight into a page under
// it cannot render with zero connectivity. This shell has no server-side
// data fetch, so it stays static/precacheable — all dynamic content loads
// client-side via GymOfflineProvider, which falls back to its IndexedDB
// cache when offline. See docs/superpowers/specs (gym tracker plan) for the
// full reasoning.
export default function GymLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4">
        <GymOfflineProvider>
          <GymStatusHeader />
          {children}
        </GymOfflineProvider>
      </main>
      <BottomNav />
    </div>
  );
}
```

New:

```tsx
import { ViewTransition } from "react";
import { BottomNav } from "@/components/BottomNav";
import { GymOfflineProvider } from "@/lib/gymOffline/context";
import { GymStatusHeader } from "@/components/gym/GymStatusHeader";

// Deliberately NOT under (dashboard) and NOT force-dynamic: that layout does
// a DB call on every request, which combined with BottomNav's plain-<a>
// full-page navigations means a cold PWA launch straight into a page under
// it cannot render with zero connectivity. This shell has no server-side
// data fetch, so it stays static/precacheable — all dynamic content loads
// client-side via GymOfflineProvider, which falls back to its IndexedDB
// cache when offline. See docs/superpowers/specs (gym tracker plan) for the
// full reasoning.
export default function GymLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4">
        <GymOfflineProvider>
          <div style={{ viewTransitionName: "site-header" }}>
            <GymStatusHeader />
          </div>
          <ViewTransition name="tab-content" share="tab-crossfade" enter="auto" default="none">
            {children}
          </ViewTransition>
        </GymOfflineProvider>
      </main>
      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 3: Anchor `BottomNav` itself**

Old (opening `<nav>` tag):

```tsx
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-neutral-200 bg-white/95 backdrop-blur
                 pb-[env(safe-area-inset-bottom)] dark:border-neutral-800 dark:bg-neutral-950/95"
      aria-label="Primary"
    >
```

New:

```tsx
    <nav
      style={{ viewTransitionName: "bottom-nav" }}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-neutral-200 bg-white/95 backdrop-blur
                 pb-[env(safe-area-inset-bottom)] dark:border-neutral-800 dark:bg-neutral-950/95"
      aria-label="Primary"
    >
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`

Expected: no errors. (`ViewTransition` is exported from `"react"` as of the React canary version Next 16 ships — if TypeScript can't find the export, run `cd web && npm ls react` and confirm the resolved version is the Next-managed canary, not a pinned stable `react` from a lockfile override; this project doesn't pin `react` directly in `package.json` dependencies today, so this shouldn't occur, but check `npx tsc --noEmit`'s exact error if it does.)

- [ ] **Step 5: Commit**

```bash
cd web && git add "src/app/(dashboard)/layout.tsx" src/app/gym/layout.tsx src/components/BottomNav.tsx && git commit -m "feat: wire ViewTransition crossfade into dashboard and gym nav"
```

---

## Task 10b: Wire the orphaned `.suspense-reveal` CSS to a real transition prop

**Discovered during the final whole-branch review.** Task 9's CSS (`web/src/app/globals.css`) defines `::view-transition-old(.suspense-reveal)` / `::view-transition-new(.suspense-reveal)` plus `slide-y`/`fade` keyframes intended for the skeleton→content handoff, but Task 10's `<ViewTransition>` JSX never assigns `"suspense-reveal"` to any of `default`/`enter`/`exit`/`share`/`update` — both layouts use `enter="auto"`, `default="none"`, `share="tab-crossfade"`. The plan's own Task 9 text claimed Task 10 would reference `suspense-reveal` from JSX, but Task 10's actual code never did — the CSS is currently dead code and the intended slide-up/fade reveal never plays (falls back to the browser-default crossfade via `enter="auto"`).

**Fix:** change `enter="auto"` to `enter="suspense-reveal"` on both `<ViewTransition name="tab-content" ...>` elements. This is the lowest-risk fix available without live browser verification (same prop, just a real class value instead of the inert default), and it's the correct transition type for "this instance is mounting and there's no other with the same name being deleted" per `ViewTransitionProps`' own doc comment — which covers the app's initial load and any case where content newly appears without a matching same-named unmount elsewhere.

Since this specific visual behavior (whether the tuned slide/fade timing is actually perceptible, and whether it's the right transition type for every skeleton→content handoff scenario, not just initial mount) can't be confirmed without a real browser, this is being wired as a reasonable, reversible improvement — not a guaranteed-correct final answer — and is added to Task 11's on-device verification list below rather than assumed correct.

**Files:**
- Modify: `web/src/app/(dashboard)/layout.tsx`
- Modify: `web/src/app/gym/layout.tsx`

**Interfaces:** no exports change — one prop value changes on an existing element in each file.

- [ ] **Step 1: `(dashboard)/layout.tsx`**

Old:

```tsx
        <ViewTransition name="tab-content" share="tab-crossfade" enter="auto" default="none">
```

New:

```tsx
        <ViewTransition name="tab-content" share="tab-crossfade" enter="suspense-reveal" default="none">
```

- [ ] **Step 2: `gym/layout.tsx`**

Same change — `enter="auto"` → `enter="suspense-reveal"` on its `<ViewTransition name="tab-content" ...>` element.

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Production build**

Run: `cd web && npm run build`

Expected: succeeds end-to-end (same as after Task 10).

- [ ] **Step 5: Run the full test suite**

Run: `cd web && npm test`

Expected: same 222 tests passing.

- [ ] **Step 6: Commit**

```bash
cd web && git add "src/app/(dashboard)/layout.tsx" src/app/gym/layout.tsx && git commit -m "fix: wire orphaned suspense-reveal CSS to the tab-content ViewTransition's enter prop"
```

---

## Task 11: Manual verification of motion and `<Activity>` state preservation

**Files:**
- None (manual verification task — no source changes expected unless a real bug is found, in which case treat it as a new bite-sized follow-up task, not a same-task patch).

**Interfaces:**
- Consumes: everything from Tasks 1–10.

- [ ] **Step 1: Build and smoke-test**

```bash
cd web && npm run build
```

Expected: build succeeds with no Cache Components errors (any remaining `force-dynamic`/uncached-data error means a route was missed in Tasks 2–6).

- [ ] **Step 2: Real-browser check (requires a browser — dev-server-only environments should hand this to the user)**

With the dev server running (same auth override as Task 8), open `http://localhost:3000/today` in a real browser and:
- Tap between all 6 bottom-nav tabs and confirm the content crossfades rather than hard-cutting, and that the header/bottom-nav never flash or reposition.
- Reload the app cold (hard refresh) and confirm the `enter="suspense-reveal"` transition (Task 10b) actually plays the intended slide-up/fade-in on initial load, rather than a plain instant appearance. If a page ever shows its `loading.tsx` skeleton (e.g. after clearing the cache or a slow cache-miss), confirm whether the skeleton→content handoff also uses this transition or just snaps — if it just snaps, that's a known limitation of the `enter`-prop wiring (see Task 10b), not a regression, and would need a nested `<Suspense>`+`<ViewTransition>` per-page to fully cover, which is out of scope here unless this looks visually broken rather than merely "less polished than intended."
- Open a bottom-sheet component (e.g. tap a workout row to open `WorkoutDetailSheet`, or "Log fueling" to open `LogFuelingSheet`), switch to a different bottom-nav tab, then switch back. Confirm whether the sheet is still open (expected under `<Activity>` preservation) and whether that's a pleasant "app remembered where I was" experience or a bug (e.g. stale data now showing in a re-opened sheet that assumed a fresh mount). If a specific sheet shows genuinely wrong data (not just "stayed open"), that's a **new** bite-sized task: close it in a `useLayoutEffect` cleanup or derive its open state from the URL per Next's ["Preserving UI state" guide](https://nextjs.org/docs/app/guides/preserving-ui-state) — don't speculatively patch every sheet component before observing an actual problem.
- Toggle "Reduce motion" in the OS/browser accessibility settings and confirm transitions become instant (no animation) rather than broken/janky.

- [ ] **Step 3: Confirm no regression in offline gym flow**

Since `gym/layout.tsx` changed (Task 10), verify the offline-first gym flow still works: open dev tools, go offline, navigate to `/gym`, and confirm `GymOfflineProvider`'s cached UI still renders (the `<ViewTransition>` wrapper added in Task 10 is presentation-only and shouldn't affect this, but it's the one file in this migration where a regression would be highest-impact).

- [ ] **Step 4: Final commit (if Step 2 surfaced no code changes, this task has nothing to commit — skip)**

If Step 2 required a follow-up fix, commit it separately with its own descriptive message following the same TDD/bite-sized pattern as the tasks above, rather than folding it silently into this verification task.
