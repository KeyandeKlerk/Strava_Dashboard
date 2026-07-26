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
        <ViewTransition name="tab-content" share="auto" enter="auto" default="none" className="tab-crossfade">
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
          <ViewTransition name="tab-content" share="auto" enter="auto" default="none" className="tab-crossfade">
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
- Open a bottom-sheet component (e.g. tap a workout row to open `WorkoutDetailSheet`, or "Log fueling" to open `LogFuelingSheet`), switch to a different bottom-nav tab, then switch back. Confirm whether the sheet is still open (expected under `<Activity>` preservation) and whether that's a pleasant "app remembered where I was" experience or a bug (e.g. stale data now showing in a re-opened sheet that assumed a fresh mount). If a specific sheet shows genuinely wrong data (not just "stayed open"), that's a **new** bite-sized task: close it in a `useLayoutEffect` cleanup or derive its open state from the URL per Next's ["Preserving UI state" guide](https://nextjs.org/docs/app/guides/preserving-ui-state) — don't speculatively patch every sheet component before observing an actual problem.
- Toggle "Reduce motion" in the OS/browser accessibility settings and confirm transitions become instant (no animation) rather than broken/janky.

- [ ] **Step 3: Confirm no regression in offline gym flow**

Since `gym/layout.tsx` changed (Task 10), verify the offline-first gym flow still works: open dev tools, go offline, navigate to `/gym`, and confirm `GymOfflineProvider`'s cached UI still renders (the `<ViewTransition>` wrapper added in Task 10 is presentation-only and shouldn't affect this, but it's the one file in this migration where a regression would be highest-impact).

- [ ] **Step 4: Final commit (if Step 2 surfaced no code changes, this task has nothing to commit — skip)**

If Step 2 required a follow-up fix, commit it separately with its own descriptive message following the same TDD/bite-sized pattern as the tasks above, rather than folding it silently into this verification task.
