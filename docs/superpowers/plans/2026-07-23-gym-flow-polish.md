# Gym Flow Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "Unknown exercise" bug in the live gym-logging flow, add a recurring weekly gym
plan (which days, which exercises per day), and rework the live session UI so moving between
exercises has an obvious, polished flow.

**Architecture:** A new `gym_plan_exercises` table (day-of-week → ordered exercise list) backs a
new `/gym/plan` builder page (online-only, plain server actions). The live session's single
`selectedExercise` state is replaced by a small ordered queue (`SessionExerciseQueue`), rendered as
a scrollable chip row, seeded from the day's plan when one exists. Both the queue and the plan's
offline cache resolve exercises by a stable key (`client_uuid` or `id`) instead of holding onto
exercise objects directly, which is what fixes the underlying bug (a custom exercise's placeholder
id gets deleted mid-sync while old code was still holding a reference to it).

**Tech Stack:** Next.js (App Router), TypeScript, DuckDB/MotherDuck, `idb` (IndexedDB wrapper),
Vitest, `fake-indexeddb`, Tailwind CSS. No new dependencies.

## Global Constraints

- No new npm dependencies — the codebase's own conventions (Tailwind utility classes, plain
  fetch/server actions, `idb`) cover everything this feature needs.
- Reordering UI must work with touch, not just a mouse — the user's primary device is iPhone
  Safari, which does not support HTML5 drag-and-drop with touch. Use ↑/↓ buttons, not drag handles.
- This app has no multi-tenancy anywhere (no `user_id` column on any table) — the weekly plan is a
  single global recurring template, not scoped to a user.
- This codebase has no automated tests for React components, Next.js API routes, or server actions
  (`web/src/lib/gymActions.ts`, `web/src/app/api/gym/*/route.ts` — confirmed no existing test files
  for any of them). Follow that convention: automated tests only for the pure/logic layers
  (`web/src/lib/db/gymMutations.ts`, new `exerciseKey.ts`, `web/src/lib/gymOffline/db.ts`); UI/wiring
  tasks are verified manually (dev server + a scripted walkthrough), not with new test files.
- Day-of-week is stored as the full English weekday name (`"Monday"`, ..., `"Sunday"`), matching
  the existing `training_plan_daily.day_of_week` column (`web/src/lib/db/schema.ts:62`) and the
  `toLocaleDateString("en-US", { weekday: "long" })` idiom already used in
  `web/src/lib/db/mutations.ts:620` and `web/src/lib/planActions.ts:54` — not a new numeric
  day-of-week convention.
- Every new table/production-schema change needs a self-contained migration script mirroring
  `web/scripts/add-gym-tables.ts`'s convention (no local imports, run manually against MotherDuck
  before the app code deploys).

---

### Task 1: Weekly plan schema + `gymMutations.ts` functions

**Files:**
- Modify: `web/src/lib/db/schema.ts:163-175` (insert new table statements after the `gym_sets`
  block, before `...buildGymExerciseSeedStatements()`)
- Modify: `web/src/lib/db/gymMutations.ts` (add `getWeeklyPlan`, `setPlanForDay`)
- Test: `web/src/lib/db/gymMutations.test.ts` (extend)

**Interfaces:**
- Produces: `getWeeklyPlan(conn: DuckDBConnection): Promise<Record<string, GymExerciseRow[]>>` —
  keys are weekday names, values are that day's exercises in plan order. A day with no plan is
  simply absent from the returned object (no empty-array entry).
- Produces: `setPlanForDay(conn: DuckDBConnection, dayOfWeek: string, exerciseIds: number[]):
  Promise<void>` — replaces the entire list for that day; `exerciseIds` order becomes the stored
  `position` order.
- Consumes: `GymExerciseRow` (already defined in `gymMutations.ts:9-16`).

- [ ] **Step 1: Write the failing tests**

Add to `web/src/lib/db/gymMutations.test.ts` (new `import` additions plus a new `describe` block —
add `getWeeklyPlan, setPlanForDay` to the existing import from `"./gymMutations"`):

```ts
describe("getWeeklyPlan / setPlanForDay", () => {
  it("returns an empty plan when nothing has been set", async () => {
    const plan = await getWeeklyPlan(conn);
    expect(plan).toEqual({});
  });

  it("sets and retrieves an ordered exercise list for a day", async () => {
    const exercises = await listGymExercises(conn);
    const squat = exercises.find((e) => e.name === "Barbell Back Squat")!;
    const legPress = exercises.find((e) => e.name === "Leg Press")!;

    await setPlanForDay(conn, "Monday", [squat.id, legPress.id]);

    const plan = await getWeeklyPlan(conn);
    expect(plan["Monday"].map((e) => e.name)).toEqual(["Barbell Back Squat", "Leg Press"]);
  });

  it("replaces (not appends to) a day's plan on a second call", async () => {
    const exercises = await listGymExercises(conn);
    const squat = exercises.find((e) => e.name === "Barbell Back Squat")!;
    const curl = exercises.find((e) => e.name === "Barbell Curl")!;

    await setPlanForDay(conn, "Monday", [squat.id]);
    await setPlanForDay(conn, "Monday", [curl.id]);

    const plan = await getWeeklyPlan(conn);
    expect(plan["Monday"].map((e) => e.name)).toEqual(["Barbell Curl"]);
  });

  it("leaves other days untouched", async () => {
    const exercises = await listGymExercises(conn);
    const squat = exercises.find((e) => e.name === "Barbell Back Squat")!;
    const curl = exercises.find((e) => e.name === "Barbell Curl")!;

    await setPlanForDay(conn, "Monday", [squat.id]);
    await setPlanForDay(conn, "Wednesday", [curl.id]);

    const plan = await getWeeklyPlan(conn);
    expect(plan["Monday"].map((e) => e.name)).toEqual(["Barbell Back Squat"]);
    expect(plan["Wednesday"].map((e) => e.name)).toEqual(["Barbell Curl"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/lib/db/gymMutations.test.ts`
Expected: FAIL — `getWeeklyPlan`/`setPlanForDay` are not exported from `./gymMutations`.

- [ ] **Step 3: Add the schema table**

In `web/src/lib/db/schema.ts`, immediately after the `gym_sets` table block (ends at line 173,
right before `...buildGymExerciseSeedStatements(),`), insert:

```ts
  `CREATE SEQUENCE IF NOT EXISTS gym_plan_exercises_id_seq START 1`,
  `CREATE TABLE IF NOT EXISTS gym_plan_exercises (
    id INTEGER PRIMARY KEY DEFAULT nextval('gym_plan_exercises_id_seq'),
    day_of_week VARCHAR NOT NULL,
    exercise_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT current_timestamp
  )`,
```

- [ ] **Step 4: Implement `getWeeklyPlan` and `setPlanForDay`**

Add to the end of `web/src/lib/db/gymMutations.ts`:

```ts
export async function getWeeklyPlan(conn: DuckDBConnection): Promise<Record<string, GymExerciseRow[]>> {
  const rows = await queryRows<{
    day_of_week: string;
    id: number;
    client_uuid: string | null;
    name: string;
    muscle_group: string;
    equipment: string | null;
    is_custom: boolean;
  }>(
    conn,
    `SELECT gpe.day_of_week, ge.id, ge.client_uuid, ge.name, ge.muscle_group, ge.equipment, ge.is_custom
     FROM gym_plan_exercises gpe
     JOIN gym_exercises ge ON ge.id = gpe.exercise_id
     ORDER BY gpe.day_of_week, gpe.position`,
  );

  const byDay: Record<string, GymExerciseRow[]> = {};
  for (const row of rows) {
    const list = byDay[row.day_of_week] ?? [];
    list.push({
      id: row.id,
      client_uuid: row.client_uuid,
      name: row.name,
      muscle_group: row.muscle_group,
      equipment: row.equipment,
      is_custom: row.is_custom,
    });
    byDay[row.day_of_week] = list;
  }
  return byDay;
}

// Whole-list replace, not a diff — a day's plan is always edited as a complete
// ordered list from the /gym/plan builder, so there's no partial-update case
// to support.
export async function setPlanForDay(conn: DuckDBConnection, dayOfWeek: string, exerciseIds: number[]): Promise<void> {
  await conn.run("DELETE FROM gym_plan_exercises WHERE day_of_week = $day", { day: dayOfWeek });
  for (let i = 0; i < exerciseIds.length; i++) {
    await conn.run(
      `INSERT INTO gym_plan_exercises (day_of_week, exercise_id, position) VALUES ($day, $exercise_id, $position)`,
      { day: dayOfWeek, exercise_id: exerciseIds[i], position: i },
    );
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/lib/db/gymMutations.test.ts`
Expected: PASS (all tests, including the pre-existing ones in this file)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/db/schema.ts web/src/lib/db/gymMutations.ts web/src/lib/db/gymMutations.test.ts
git commit -m "feat: add gym_plan_exercises table and getWeeklyPlan/setPlanForDay"
```

---

### Task 2: Stable-key exercise resolution (`exerciseKey.ts`)

This is the pure-function core of the bug fix — a standalone module with no dependency on React or
IndexedDB, so it's fully unit-testable and can be built before touching any component.

**Files:**
- Create: `web/src/lib/gymOffline/exerciseKey.ts`
- Test: `web/src/lib/gymOffline/exerciseKey.test.ts`

**Interfaces:**
- Consumes: `CachedExercise` (`web/src/lib/gymOffline/db.ts:17-24`).
- Produces: `keyFor(exercise: CachedExercise): string`, `resolveByKey(exercises: CachedExercise[],
  key: string | null): CachedExercise | null` — used by Task 7's `SessionExerciseQueue` and the
  rewritten `LiveSessionPanel`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/gymOffline/exerciseKey.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CachedExercise } from "./db";
import { keyFor, resolveByKey } from "./exerciseKey";

function makeExercise(overrides: Partial<CachedExercise> = {}): CachedExercise {
  return {
    id: 1,
    client_uuid: null,
    name: "Barbell Squat",
    muscle_group: "Quads",
    equipment: "barbell",
    is_custom: false,
    ...overrides,
  };
}

describe("keyFor", () => {
  it("uses client_uuid when present", () => {
    const exercise = makeExercise({ id: -123, client_uuid: "abc-uuid" });
    expect(keyFor(exercise)).toBe("abc-uuid");
  });

  it("falls back to the stringified id when client_uuid is null", () => {
    const exercise = makeExercise({ id: 42, client_uuid: null });
    expect(keyFor(exercise)).toBe("42");
  });
});

describe("resolveByKey", () => {
  it("returns null for a null key", () => {
    expect(resolveByKey([makeExercise()], null)).toBeNull();
  });

  it("resolves a custom exercise's key across an id reassignment", () => {
    // Reproduces the "Unknown exercise" bug scenario: a placeholder exercise
    // (negative id) gets its id reassigned to a real one once it syncs
    // (see queue.ts's create_exercise handling), but its client_uuid never
    // changes.
    const beforeSync = makeExercise({ id: -555, client_uuid: "custom-1", name: "My Exercise" });
    const key = keyFor(beforeSync);

    const afterSync = makeExercise({ id: 88, client_uuid: "custom-1", name: "My Exercise" });

    expect(resolveByKey([afterSync], key)).toEqual(afterSync);
  });

  it("returns null when the keyed exercise is no longer in the cache", () => {
    const exercise = makeExercise({ id: -1, client_uuid: "gone" });
    const key = keyFor(exercise);
    expect(resolveByKey([], key)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/lib/gymOffline/exerciseKey.test.ts`
Expected: FAIL — cannot find module `./exerciseKey`.

- [ ] **Step 3: Implement `exerciseKey.ts`**

Create `web/src/lib/gymOffline/exerciseKey.ts`:

```ts
// A custom exercise is cached under a negative placeholder id until its
// create_exercise mutation syncs, at which point queue.ts deletes the
// placeholder row and reassigns any already-logged sets to the real id (see
// queue.ts's "create_exercise" case). Components that hold a selected
// exercise across that transition must key off client_uuid, not id — id can
// change (and the placeholder row can disappear) underneath a held
// reference, but client_uuid never does. Library exercises have no
// client_uuid and a stable id, so they key off the id instead.
import type { CachedExercise } from "./db";

export function keyFor(exercise: CachedExercise): string {
  return exercise.client_uuid ?? String(exercise.id);
}

export function resolveByKey(exercises: CachedExercise[], key: string | null): CachedExercise | null {
  if (!key) return null;
  return exercises.find((e) => keyFor(e) === key) ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/lib/gymOffline/exerciseKey.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/gymOffline/exerciseKey.ts web/src/lib/gymOffline/exerciseKey.test.ts
git commit -m "feat: add stable-key exercise resolution to fix stale-reference bug"
```

---

### Task 3: Offline plan cache (`planCache` IndexedDB store)

**Files:**
- Modify: `web/src/lib/gymOffline/db.ts`
- Test: Create `web/src/lib/gymOffline/db.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CachedPlanDay { dayOfWeek: string; exerciseIds: number[] }`,
  `replacePlanCache(db: GymOfflineDb, days: CachedPlanDay[]): Promise<void>`,
  `listPlanCache(db: GymOfflineDb): Promise<CachedPlanDay[]>` — used by Task 4's
  `GymOfflineProvider` and Task 7's `SessionExerciseQueue`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/gymOffline/db.test.ts`:

```ts
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getGymOfflineDb,
  listExercisesCache,
  listPlanCache,
  replacePlanCache,
  resetGymOfflineDbForTests,
  type GymOfflineDb,
} from "./db";

let db: GymOfflineDb;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetGymOfflineDbForTests();
  db = await getGymOfflineDb();
});

describe("planCache", () => {
  it("stores and replaces the weekly plan", async () => {
    await replacePlanCache(db, [
      { dayOfWeek: "Monday", exerciseIds: [1, 2] },
      { dayOfWeek: "Wednesday", exerciseIds: [3] },
    ]);
    expect(await listPlanCache(db)).toHaveLength(2);

    await replacePlanCache(db, [{ dayOfWeek: "Friday", exerciseIds: [4] }]);
    expect(await listPlanCache(db)).toEqual([{ dayOfWeek: "Friday", exerciseIds: [4] }]);
  });
});

describe("v1 -> v2 migration", () => {
  it("adds planCache to an existing v1 database without losing existing data", async () => {
    globalThis.indexedDB = new IDBFactory();
    resetGymOfflineDbForTests();

    // Simulate an install that's already on the current (pre-this-change) v1 schema.
    const v1 = await openDB("gym-offline", 1, {
      upgrade(db) {
        const mutations = db.createObjectStore("pendingMutations", { keyPath: "clientUuid" });
        mutations.createIndex("by-createdAt", "createdAt");
        db.createObjectStore("exercisesCache", { keyPath: "id" });
        db.createObjectStore("sessionsCache", { keyPath: "clientUuid" });
        const sets = db.createObjectStore("setsCache", { keyPath: "clientUuid" });
        sets.createIndex("by-sessionClientUuid", "sessionClientUuid");
        db.createObjectStore("recentSessionsCache", { keyPath: "id" });
      },
    });
    await v1.put("exercisesCache", {
      id: 1,
      client_uuid: null,
      name: "Existing Exercise",
      muscle_group: "Chest",
      equipment: null,
      is_custom: false,
    });
    v1.close();

    const migrated = await getGymOfflineDb();
    const exercises = await listExercisesCache(migrated);
    expect(exercises).toHaveLength(1);
    expect(exercises[0].name).toBe("Existing Exercise");

    await replacePlanCache(migrated, [{ dayOfWeek: "Monday", exerciseIds: [1] }]);
    expect(await listPlanCache(migrated)).toEqual([{ dayOfWeek: "Monday", exerciseIds: [1] }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/lib/gymOffline/db.test.ts`
Expected: FAIL — `replacePlanCache`/`listPlanCache` not exported, `planCache` store doesn't exist.

- [ ] **Step 3: Add the `planCache` store, bump `DB_VERSION`, guard the upgrade**

In `web/src/lib/gymOffline/db.ts`:

Add after the `CachedRecentSession` interface (currently ending at line 57):

```ts
export interface CachedPlanDay {
  dayOfWeek: string; // full weekday name, e.g. "Monday"
  exerciseIds: number[]; // in position order
}
```

Add to `GymOfflineSchema` (currently lines 59-82), inside the interface body:

```ts
  planCache: {
    key: string;
    value: CachedPlanDay;
  };
```

Change `DB_VERSION` (currently line 87):

```ts
const DB_VERSION = 2;
```

Replace the `upgrade(db)` callback (currently lines 94-102) with a guarded version — existing
installs are already on version 1 with the first five stores already created, so re-running
`createObjectStore` unconditionally for them would throw:

```ts
      upgrade(db) {
        if (!db.objectStoreNames.contains("pendingMutations")) {
          const mutations = db.createObjectStore("pendingMutations", { keyPath: "clientUuid" });
          mutations.createIndex("by-createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains("exercisesCache")) {
          db.createObjectStore("exercisesCache", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("sessionsCache")) {
          db.createObjectStore("sessionsCache", { keyPath: "clientUuid" });
        }
        if (!db.objectStoreNames.contains("setsCache")) {
          const sets = db.createObjectStore("setsCache", { keyPath: "clientUuid" });
          sets.createIndex("by-sessionClientUuid", "sessionClientUuid");
        }
        if (!db.objectStoreNames.contains("recentSessionsCache")) {
          db.createObjectStore("recentSessionsCache", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("planCache")) {
          db.createObjectStore("planCache", { keyPath: "dayOfWeek" });
        }
      },
```

Add after `listRecentSessionsCache` (end of file, currently line 203):

```ts
export async function replacePlanCache(db: GymOfflineDb, days: CachedPlanDay[]): Promise<void> {
  const tx = db.transaction("planCache", "readwrite");
  await tx.store.clear();
  for (const day of days) await tx.store.put(day);
  await tx.done;
}

export async function listPlanCache(db: GymOfflineDb): Promise<CachedPlanDay[]> {
  return db.getAll("planCache");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/lib/gymOffline/db.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full existing offline test suite to check nothing else broke**

Run: `cd web && npx vitest run src/lib/gymOffline/`
Expected: PASS (this file's new tests plus the existing `queue.test.ts`)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/gymOffline/db.ts web/src/lib/gymOffline/db.test.ts
git commit -m "feat: add planCache IndexedDB store with guarded v1->v2 migration"
```

---

### Task 4: Wire the plan through bootstrap and `GymOfflineProvider`

No automated test for this task (API routes and `GymOfflineProvider` have no existing test
coverage in this codebase — see Global Constraints). Verified manually in Step 4.

**Files:**
- Modify: `web/src/app/api/gym/bootstrap/route.ts`
- Modify: `web/src/lib/gymOffline/context.tsx`

**Interfaces:**
- Consumes: `getWeeklyPlan` (Task 1), `replacePlanCache`/`listPlanCache` (Task 3).
- Produces: `useGymOffline().planByDay: Record<string, number[]>` — consumed by Task 7's
  `SessionExerciseQueue`.

- [ ] **Step 1: Extend the bootstrap route**

Replace `web/src/app/api/gym/bootstrap/route.ts` in full:

```ts
// Used by the offline sync manager (web/src/lib/gymOffline/) to hydrate/
// refresh the client-side IndexedDB cache whenever the app has connectivity,
// independent of a full page reload.
import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db/client";
import { getWeeklyPlan, listGymExercises, listRecentGymSessions } from "@/lib/db/gymMutations";

export const runtime = "nodejs";

export async function GET() {
  const conn = await getConnection();
  const [exercises, recentSessions, plan] = await Promise.all([
    listGymExercises(conn),
    listRecentGymSessions(conn),
    getWeeklyPlan(conn),
  ]);
  // Reshaped to just exercise ids per day — the client already caches full
  // exercise rows separately (exercisesCache) and resolves plan entries
  // against that cache, so there's no reason to duplicate the exercise data
  // itself in the plan payload.
  const planByDay = Object.fromEntries(
    Object.entries(plan).map(([day, dayExercises]) => [day, dayExercises.map((e) => e.id)]),
  );
  return NextResponse.json({ exercises, recentSessions, planByDay });
}
```

- [ ] **Step 2: Thread `planByDay` through `GymOfflineProvider`**

In `web/src/lib/gymOffline/context.tsx`:

Add to the imports from `"./db"` (currently lines 11-30):

```ts
  listPlanCache,
  replacePlanCache,
```

(insert alphabetically alongside the existing `list*`/`replace*` imports)

Add state, after the `recentSessions` state (currently line 80):

```ts
  const [planByDay, setPlanByDay] = useState<Record<string, number[]>>({});
```

Update the `refresh` callback (currently lines 87-101) to also load the plan cache:

```ts
  const refresh = useCallback(async () => {
    const db = await getGymOfflineDb();
    const [exerciseRows, sessionRows, setRows, recentRows, pending, planRows] = await Promise.all([
      listExercisesCache(db),
      listSessionsCache(db),
      listAllSetsCache(db),
      listRecentSessionsCache(db),
      listPendingMutations(db),
      listPlanCache(db),
    ]);
    setExercises(exerciseRows);
    setSessions(sessionRows);
    setSets(setRows);
    setRecentSessions(recentRows);
    setPendingCount(pending.length);
    setPlanByDay(Object.fromEntries(planRows.map((p) => [p.dayOfWeek, p.exerciseIds])));
  }, []);
```

Update the `bootstrap` callback (currently lines 115-132) to cache the plan:

```ts
  const bootstrap = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    try {
      const res = await fetch("/api/gym/bootstrap");
      if (!res.ok) return;
      const body = (await res.json()) as {
        exercises: CachedExercise[];
        recentSessions: CachedRecentSession[];
        planByDay: Record<string, number[]>;
      };
      const db = await getGymOfflineDb();
      // Only the curated/synced library is replaced wholesale — locally
      // pending custom exercises (negative placeholder ids) aren't part of
      // this response and are left alone; the queue reconciles them once
      // their create_exercise mutation syncs.
      const pendingCustom = (await listExercisesCache(db)).filter((e) => e.id < 0);
      await replaceExercisesCache(db, [...body.exercises, ...pendingCustom]);
      await replaceRecentSessionsCache(db, body.recentSessions);
      await replacePlanCache(
        db,
        Object.entries(body.planByDay).map(([dayOfWeek, exerciseIds]) => ({ dayOfWeek, exerciseIds })),
      );
    } catch {
      // offline — cache stays as-is
    }
  }, []);
```

Add `planByDay` to the `GymOfflineContextValue` interface (currently lines 51-66), alongside
`recentSessions`:

```ts
  planByDay: Record<string, number[]>;
```

Add `planByDay` to the provider's context value object (currently lines 307-326), alongside
`recentSessions`:

```ts
        planByDay,
```

- [ ] **Step 3: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Run: `cd web && npm run dev`, open `/gym` in a browser with devtools open on the Application/Storage
tab. Confirm:
- The `/api/gym/bootstrap` network response now includes a `planByDay` field (empty object `{}` is
  correct at this point — nothing has been planned yet).
- IndexedDB → `gym-offline` database now shows a `planCache` object store (empty is fine).

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/gym/bootstrap/route.ts web/src/lib/gymOffline/context.tsx
git commit -m "feat: thread weekly plan through bootstrap and GymOfflineProvider"
```

---

### Task 5: Plan server actions

No automated test (matches this codebase's existing convention of not testing `gymActions.ts`).

**Files:**
- Modify: `web/src/lib/gymActions.ts`

**Interfaces:**
- Consumes: `getWeeklyPlan`, `setPlanForDay` (Task 1).
- Produces: `getWeeklyPlanAction(): Promise<Record<string, GymExerciseRow[]>>`,
  `setPlanForDayAction(dayOfWeek: string, exerciseIds: number[]): Promise<void>` — consumed by
  Task 10's `/gym/plan` page and `PlanBuilder`.

- [ ] **Step 1: Add the two actions**

In `web/src/lib/gymActions.ts`, add `getWeeklyPlan, setPlanForDay` to the existing import from
`"./db/gymMutations"` (currently lines 8-17), then add at the end of the file:

```ts
export async function getWeeklyPlanAction(): Promise<Record<string, GymExerciseRow[]>> {
  const conn = await getConnection();
  return getWeeklyPlan(conn);
}

export async function setPlanForDayAction(dayOfWeek: string, exerciseIds: number[]): Promise<void> {
  const conn = await getConnection();
  await setPlanForDay(conn, dayOfWeek, exerciseIds);
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/gymActions.ts
git commit -m "feat: add getWeeklyPlanAction/setPlanForDayAction server actions"
```

---

### Task 6: Production migration script

**Files:**
- Create: `web/scripts/add-gym-plan-table.ts`

- [ ] **Step 1: Write the script**

Create `web/scripts/add-gym-plan-table.ts`:

```ts
// One-time migration: add the gym_plan_exercises table for the recurring
// weekly gym plan feature.
// Run once against the live MotherDuck database. NOT part of the deployed
// app — do not run this until the app code that queries this table is ready
// to deploy alongside it.
//
// Self-contained (no local imports), same convention as add-gym-tables.ts —
// see that script's header comment for why.
//
// Usage:
//   MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
//     node scripts/add-gym-plan-table.ts
import { DuckDBInstance } from "@duckdb/node-api";

async function main() {
  const motherduckUrl = process.env.MOTHERDUCK_DATABASE_URL;
  if (!motherduckUrl) {
    console.error("MOTHERDUCK_DATABASE_URL is required, e.g. md:strava_dashboard?motherduck_token=<token>");
    process.exit(1);
  }

  const match = motherduckUrl.match(/^md:([^?]+)(?:\?motherduck_token=(.+))?$/);
  if (!match) {
    console.error(`MOTHERDUCK_DATABASE_URL must look like md:<dbname>?motherduck_token=<token>, got: ${motherduckUrl}`);
    process.exit(1);
  }
  const [, dbName, token] = match;
  if (token) process.env.motherduck_token = token;

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  console.log("Attaching MotherDuck DB");
  await conn.run(`ATTACH 'md:${dbName}' AS md`);
  await conn.run("USE md");

  console.log("Creating gym_plan_exercises");
  await conn.run("CREATE SEQUENCE IF NOT EXISTS gym_plan_exercises_id_seq START 1");
  await conn.run(`
    CREATE TABLE IF NOT EXISTS gym_plan_exercises (
      id INTEGER PRIMARY KEY DEFAULT nextval('gym_plan_exercises_id_seq'),
      day_of_week VARCHAR NOT NULL,
      exercise_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT current_timestamp
    )
  `);

  conn.closeSync();
  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it runs against a scratch local database**

Run: `cd web && MOTHERDUCK_DATABASE_URL="md:__scratch_test?motherduck_token=invalid" node --experimental-strip-types scripts/add-gym-plan-table.ts`
Expected: fails at the `ATTACH` step with an auth/connection error (there's no real token) — this
just confirms the script parses and runs up to the network call. Do **not** run this against the
real production database yet; that happens only when this feature is ready to deploy (per this
script's own header comment and the Global Constraints).

- [ ] **Step 3: Commit**

```bash
git add web/scripts/add-gym-plan-table.ts
git commit -m "feat: add production migration script for gym_plan_exercises"
```

---

### Task 7: Session queue — `SessionExerciseQueue` (bug fix + chip-row transition)

This is the task that actually fixes the "Unknown exercise" bug (by removing the last place that
held a raw `CachedExercise` object as selection state) and adds the chip-row transition UI. No
automated test (no React component testing in this codebase — see Global Constraints); verified
manually in Step 4.

**Known limitation, worth understanding before writing this:** the queue's order/progress
(`queueKeys`/`currentKey`) is plain React state, not persisted anywhere. A page reload mid-session
reseeds the queue fresh from the day's plan. Already-logged sets are never lost (`ActiveSessionSets`
reads directly from the durable `setsCache` IndexedDB store, untouched by this component), but an
exercise added via "+ Add" or swapped in — if not yet logged — won't reappear in the queue after a
reload; it can simply be re-added. This is an accepted tradeoff, not a bug to fix here.

**Files:**
- Create: `web/src/components/gym/SessionExerciseQueue.tsx`
- Modify: `web/src/components/gym/LiveSessionPanel.tsx`
- Modify: `web/src/components/gym/SetEntryForm.tsx`

**Interfaces:**
- Consumes: `keyFor`, `resolveByKey` (Task 2); `useGymOffline().planByDay` (Task 4);
  `ExercisePicker` (unchanged, `web/src/components/gym/ExercisePicker.tsx`); `CachedExercise`,
  `CachedSet` (`web/src/lib/gymOffline/db.ts`).
- Produces: `<SessionExerciseQueue sessionClientUuid, activeSessionSets, planDayName>` — the only
  new prop surface `LiveSessionPanel` needs to know about.

- [ ] **Step 1: Update `SetEntryForm` to support Swap/Next**

Replace `web/src/components/gym/SetEntryForm.tsx` in full:

```tsx
"use client";
import { useState } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { useWeightUnit } from "@/lib/gymOffline/useWeightUnit";
import type { CachedExercise } from "@/lib/gymOffline/db";

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export function SetEntryForm({
  sessionClientUuid,
  exercise,
  nextSetNumber,
  onSwap,
  showNext,
  onNext,
}: {
  sessionClientUuid: string;
  exercise: CachedExercise;
  nextSetNumber: number;
  onSwap: () => void;
  showNext: boolean;
  onNext: () => void;
}) {
  const { logSet } = useGymOffline();
  const { unit, toKg } = useWeightUnit();
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(formData: FormData) {
    const weightValue = Number(formData.get("weight"));
    const repsValue = Number(formData.get("reps"));
    if (!Number.isFinite(weightValue) || weightValue <= 0) return;
    if (!Number.isInteger(repsValue) || repsValue <= 0) return;

    setIsSaving(true);
    try {
      await logSet({
        sessionClientUuid,
        exercise,
        setNumber: nextSetNumber,
        weightKg: toKg(weightValue),
        reps: repsValue,
      });
      setWeight("");
      setReps("");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      action={handleSubmit}
      className="rounded-xl border border-neutral-200 p-3 shadow-sm dark:border-neutral-800"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{exercise.name}</p>
        <button type="button" onClick={onSwap} className="text-xs text-neutral-500 underline">
          Swap
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          name="weight"
          type="number"
          inputMode="decimal"
          step="0.5"
          min="0"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder={`Weight (${unit})`}
          required
          className={FIELD_CLASS}
        />
        <input
          name="reps"
          type="number"
          inputMode="numeric"
          step="1"
          min="1"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          placeholder="Reps"
          required
          className={FIELD_CLASS}
        />
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={isSaving}
          className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Log set {nextSetNumber}
        </button>
        {showNext && (
          <button
            type="button"
            onClick={onNext}
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
          >
            Next exercise →
          </button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Create `SessionExerciseQueue`**

Create `web/src/components/gym/SessionExerciseQueue.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { keyFor, resolveByKey } from "@/lib/gymOffline/exerciseKey";
import { ExercisePicker } from "./ExercisePicker";
import { SetEntryForm } from "./SetEntryForm";
import type { CachedExercise, CachedSet } from "@/lib/gymOffline/db";

type PickerMode = null | "add" | "swap";

export function SessionExerciseQueue({
  sessionClientUuid,
  activeSessionSets,
  planDayName,
}: {
  sessionClientUuid: string;
  activeSessionSets: CachedSet[];
  planDayName: string;
}) {
  const { exercises, planByDay } = useGymOffline();
  const [queueKeys, setQueueKeys] = useState<string[]>([]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [seeded, setSeeded] = useState(false);

  // Seed the queue once from today's plan, as soon as the exercise library
  // (needed to resolve plan exercise ids to CachedExercise objects) is
  // loaded. Only ever seeds once per mount — re-running this whenever
  // `exercises` refreshes (e.g. after every set logged) would stomp on
  // later swap/add/next interactions.
  useEffect(() => {
    if (seeded || exercises.length === 0) return;
    const planIds = planByDay[planDayName] ?? [];
    const seededExercises = planIds
      .map((id) => exercises.find((e) => e.id === id))
      .filter((e): e is CachedExercise => e != null);
    if (seededExercises.length > 0) {
      setQueueKeys(seededExercises.map(keyFor));
      setCurrentKey(keyFor(seededExercises[0]));
    }
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises, planByDay, planDayName, seeded]);

  const queueExercises = useMemo(
    () => queueKeys.map((key) => resolveByKey(exercises, key)).filter((e): e is CachedExercise => e != null),
    [queueKeys, exercises],
  );

  const currentExercise = resolveByKey(exercises, currentKey);

  const loggedExerciseIds = useMemo(
    () => new Set(activeSessionSets.map((s) => s.exerciseId)),
    [activeSessionSets],
  );

  function handleAdd(exercise: CachedExercise) {
    const key = keyFor(exercise);
    setQueueKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setCurrentKey(key);
    setPickerMode(null);
  }

  function handleSwap(exercise: CachedExercise) {
    const newKey = keyFor(exercise);
    setQueueKeys((prev) => prev.map((key) => (key === currentKey ? newKey : key)));
    setCurrentKey(newKey);
    setPickerMode(null);
  }

  function handleNext() {
    const nextUnlogged = queueExercises.find((e) => !loggedExerciseIds.has(e.id));
    if (nextUnlogged) {
      setCurrentKey(keyFor(nextUnlogged));
    } else {
      setCurrentKey(null);
      setPickerMode("add");
    }
  }

  const nextSetNumber = useMemo(() => {
    if (!currentExercise) return 1;
    return activeSessionSets.filter((s) => s.exerciseId === currentExercise.id).length + 1;
  }, [activeSessionSets, currentExercise]);

  if (pickerMode === "add" || pickerMode === "swap") {
    return (
      <div>
        <ExercisePicker onSelect={pickerMode === "add" ? handleAdd : handleSwap} />
        {(queueKeys.length > 0 || pickerMode === "swap") && (
          <button type="button" onClick={() => setPickerMode(null)} className="mt-2 text-xs text-neutral-500">
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (!currentExercise) {
    return <ExercisePicker onSelect={handleAdd} />;
  }

  const hasLoggedCurrent = loggedExerciseIds.has(currentExercise.id);

  return (
    <div>
      {queueExercises.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1.5">
          {queueExercises.map((exercise) => {
            const key = keyFor(exercise);
            const done = loggedExerciseIds.has(exercise.id);
            const active = key === currentKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCurrentKey(key)}
                className={`flex-none whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : done
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
                }`}
              >
                {done && !active ? "✓ " : ""}
                {exercise.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPickerMode("add")}
            className="flex-none whitespace-nowrap rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
          >
            + Add
          </button>
        </div>
      )}

      <div key={currentKey} className="mt-2 transition-opacity duration-150">
        <SetEntryForm
          sessionClientUuid={sessionClientUuid}
          exercise={currentExercise}
          nextSetNumber={nextSetNumber}
          onSwap={() => setPickerMode("swap")}
          showNext={hasLoggedCurrent}
          onNext={handleNext}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `LiveSessionPanel` to use the queue**

Replace `web/src/components/gym/LiveSessionPanel.tsx` in full:

```tsx
"use client";
import { useMemo } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { SessionExerciseQueue } from "./SessionExerciseQueue";
import { ActiveSessionSets } from "./ActiveSessionSets";
import { WeightUnitToggle } from "./WeightUnitToggle";

function todayIso(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function weekdayNameFor(sessionDate: string): string {
  return new Date(`${sessionDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
}

export function LiveSessionPanel() {
  const { sessions, sets, pendingCount, isOnline, startSession, endSession } = useGymOffline();

  // The most recently started session that hasn't been ended yet — durable
  // across reloads/app kills since sessionsCache lives in IndexedDB, not
  // React state.
  const activeSession = useMemo(() => {
    return [...sessions]
      .filter((s) => !s.endedAt)
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
  }, [sessions]);

  const activeSessionSets = useMemo(() => {
    if (!activeSession) return [];
    return sets.filter((s) => s.sessionClientUuid === activeSession.clientUuid);
  }, [sets, activeSession]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Gym</h2>
        <div className="flex items-center gap-2">
          {!isOnline && <span className="text-xs text-amber-600">Offline</span>}
          {pendingCount > 0 && <span className="text-xs text-neutral-500">{pendingCount} pending sync</span>}
          <WeightUnitToggle />
        </div>
      </div>

      {!activeSession ? (
        <button
          type="button"
          onClick={() => startSession(todayIso())}
          className="mt-3 w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Start session
        </button>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-neutral-500">Session started {activeSession.sessionDate}</p>

          <ActiveSessionSets sets={activeSessionSets} />

          <div className="mt-3">
            <SessionExerciseQueue
              sessionClientUuid={activeSession.clientUuid}
              activeSessionSets={activeSessionSets}
              planDayName={weekdayNameFor(activeSession.sessionDate)}
            />
          </div>

          <button
            type="button"
            onClick={() => endSession(activeSession.clientUuid)}
            className="mt-4 w-full rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 dark:border-red-900"
          >
            End session
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual verification — the bug fix**

Run: `cd web && npm run dev`, open `/gym`. Start a session, tap "+ Add a custom exercise", create
one (e.g. "Test Exercise A"), pick a muscle group, submit. Wait ~2 seconds (enough for the sync
flush to complete if online), then log a weight/reps set for it. Confirm the set appears under
`ActiveSessionSets` labeled "Test Exercise A" — not "Unknown exercise" — both immediately and after
a page refresh.

- [ ] **Step 6: Manual verification — the queue**

With no plan configured yet (Task 10 not done): confirm starting a session shows the picker
directly (empty-queue fallback), and after picking one exercise, a single chip appears for it.
Log a set, confirm "Next exercise →" appears, tap it, confirm it opens "+ Add" (since the queue
has nothing else queued). Add a second exercise via "+ Add", confirm both chips show, tap between
them, confirm "Swap" replaces the current chip's exercise without duplicating a chip.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/gym/SessionExerciseQueue.tsx web/src/components/gym/LiveSessionPanel.tsx web/src/components/gym/SetEntryForm.tsx
git commit -m "feat: replace single-exercise selection with session queue, fixing stale-reference bug"
```

---

### Task 8: `ActiveSessionSets` visual polish

**Files:**
- Modify: `web/src/components/gym/ActiveSessionSets.tsx`

- [ ] **Step 1: Apply consistent card styling**

Replace `web/src/components/gym/ActiveSessionSets.tsx` in full:

```tsx
"use client";
import { useGymOffline } from "@/lib/gymOffline/context";
import { useWeightUnit } from "@/lib/gymOffline/useWeightUnit";
import type { CachedSet } from "@/lib/gymOffline/db";

export function ActiveSessionSets({ sets }: { sets: CachedSet[] }) {
  const { exercises, deleteSet } = useGymOffline();
  const { unit, toDisplay } = useWeightUnit();

  if (sets.length === 0) {
    return <p className="mt-3 text-sm text-neutral-500">No sets logged yet.</p>;
  }

  const byExercise = new Map<number, CachedSet[]>();
  for (const set of sets) {
    const list = byExercise.get(set.exerciseId) ?? [];
    list.push(set);
    byExercise.set(set.exerciseId, list);
  }

  return (
    <div className="mt-3 space-y-2">
      {[...byExercise.entries()].map(([exerciseId, exerciseSets]) => {
        const exercise = exercises.find((e) => e.id === exerciseId);
        return (
          <div key={exerciseId} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <p className="text-xs font-medium text-neutral-500">{exercise?.name ?? "Unknown exercise"}</p>
            {exerciseSets
              .sort((a, b) => a.setNumber - b.setNumber)
              .map((set) => (
                <div key={set.clientUuid} className="mt-1 flex items-center justify-between text-sm">
                  <span>
                    Set {set.setNumber}: {toDisplay(set.weightKg).toFixed(1)}
                    {unit} x {set.reps}
                  </span>
                  <button type="button" onClick={() => deleteSet(set.clientUuid)} className="text-xs text-red-600">
                    Remove
                  </button>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
```

(Only the returned JSX's wrapping `div` changed: `space-y-3` → `space-y-2` and each exercise group
now has a `rounded-xl border ... p-3` card, matching `SetEntryForm`'s card treatment from Task 7.)

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

With a session active and a couple of sets logged across two exercises, confirm each exercise's
set group now renders inside a bordered card with consistent spacing, matching the current
exercise's card below it.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/gym/ActiveSessionSets.tsx
git commit -m "style: consistent card styling for logged-sets list"
```

---

### Task 9: Plan builder — `/gym/plan` page and `PlanBuilder`

**Files:**
- Create: `web/src/components/gym/PlanBuilder.tsx`
- Create: `web/src/app/gym/plan/page.tsx`
- Modify: `web/src/app/gym/page.tsx`

**Interfaces:**
- Consumes: `getWeeklyPlanAction`, `setPlanForDayAction`, `addCustomExerciseAction`,
  `listGymExercisesAction` (Task 5, and pre-existing in `gymActions.ts`), `GymExerciseRow`
  (`web/src/lib/db/gymMutations.ts`), `MUSCLE_GROUPS` (`web/src/lib/db/gymExerciseSeed.ts`).

- [ ] **Step 1: Create `PlanBuilder`**

Create `web/src/components/gym/PlanBuilder.tsx`:

```tsx
"use client";
import { useState } from "react";
import { addCustomExerciseAction, setPlanForDayAction } from "@/lib/gymActions";
import { MUSCLE_GROUPS } from "@/lib/db/gymExerciseSeed";
import type { GymExerciseRow } from "@/lib/db/gymMutations";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

// Deliberately separate from ExercisePicker (web/src/components/gym/ExercisePicker.tsx):
// that component is coupled to the offline GymOfflineProvider/CachedExercise cache, while
// this one works directly off server-action data (GymExerciseRow) since plan editing is
// online-only. The search/group-filter logic is small enough that duplicating it here is
// simpler than forcing a shared abstraction over two different data sources.
function PlanExercisePicker({
  allExercises,
  onSelect,
  onCancel,
}: {
  allExercises: GymExerciseRow[];
  onSelect: (exercise: GymExerciseRow) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);

  const query = search.trim().toLowerCase();
  const filtered = query ? allExercises.filter((e) => e.name.toLowerCase().includes(query)) : allExercises;
  const byGroup = new Map<string, GymExerciseRow[]>();
  for (const exercise of filtered) {
    const list = byGroup.get(exercise.muscle_group) ?? [];
    list.push(exercise);
    byGroup.set(exercise.muscle_group, list);
  }

  async function handleCreateCustom(formData: FormData) {
    const result = await addCustomExerciseAction(formData);
    if (result.exercise) onSelect(result.exercise);
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search exercises..."
        className={FIELD_CLASS}
      />
      <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        {[...byGroup.entries()].map(([muscleGroup, list]) => (
          <div key={muscleGroup}>
            <p className="bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              {muscleGroup}
            </p>
            {list.map((exercise) => (
              <button
                key={exercise.id}
                type="button"
                onClick={() => onSelect(exercise)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                {exercise.name}
              </button>
            ))}
          </div>
        ))}
        {byGroup.size === 0 && <p className="px-3 py-2 text-sm text-neutral-500">No matches.</p>}
      </div>

      {!showCustomForm ? (
        <button
          type="button"
          onClick={() => setShowCustomForm(true)}
          className="mt-2 text-xs text-neutral-500 underline"
        >
          + Add a custom exercise
        </button>
      ) : (
        <form action={handleCreateCustom} className="mt-2 space-y-2">
          <input name="name" placeholder="Exercise name" required className={FIELD_CLASS} />
          <select name="muscle_group" required className={FIELD_CLASS}>
            {MUSCLE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Add
          </button>
        </form>
      )}

      <button type="button" onClick={onCancel} className="mt-2 text-xs text-neutral-500">
        Cancel
      </button>
    </div>
  );
}

export function PlanBuilder({
  initialPlan,
  allExercises,
}: {
  initialPlan: Record<string, GymExerciseRow[]>;
  allExercises: GymExerciseRow[];
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [exerciseLibrary, setExerciseLibrary] = useState(allExercises);
  const [selectedDay, setSelectedDay] = useState<(typeof WEEKDAYS)[number]>("Monday");
  const [showPicker, setShowPicker] = useState(false);

  const dayExercises = plan[selectedDay] ?? [];

  async function persist(day: string, dayExercises: GymExerciseRow[]) {
    setPlan((prev) => ({ ...prev, [day]: dayExercises }));
    await setPlanForDayAction(day, dayExercises.map((e) => e.id));
  }

  function moveExercise(index: number, direction: -1 | 1) {
    const next = [...dayExercises];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    persist(selectedDay, next);
  }

  function removeExercise(index: number) {
    persist(
      selectedDay,
      dayExercises.filter((_, i) => i !== index),
    );
  }

  function addExercise(exercise: GymExerciseRow) {
    if (!exerciseLibrary.some((e) => e.id === exercise.id)) {
      setExerciseLibrary((prev) => [...prev, exercise]);
    }
    setShowPicker(false);
    if (dayExercises.some((e) => e.id === exercise.id)) return;
    persist(selectedDay, [...dayExercises, exercise]);
  }

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-1.5">
        {WEEKDAYS.map((day) => {
          const count = plan[day]?.length ?? 0;
          const active = day === selectedDay;
          return (
            <button
              key={day}
              type="button"
              onClick={() => {
                setSelectedDay(day);
                setShowPicker(false);
              }}
              className={`flex-none whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition-colors ${
                active
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
              }`}
            >
              {day.slice(0, 3)}
              {count > 0 ? ` · ${count}` : ""}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs font-medium text-neutral-500">
        {selectedDay} —{" "}
        {dayExercises.length === 0 ? "rest day" : `${dayExercises.length} exercise${dayExercises.length === 1 ? "" : "s"}`}
      </p>

      <div className="mt-2 space-y-2">
        {dayExercises.map((exercise, index) => (
          <div
            key={exercise.id}
            className="flex items-center justify-between rounded-xl border border-neutral-200 p-3 text-sm dark:border-neutral-800"
          >
            <span>
              {index + 1}. {exercise.name}
            </span>
            <div className="flex items-center gap-3 text-xs text-neutral-500">
              <button type="button" onClick={() => moveExercise(index, -1)} disabled={index === 0}>
                ↑
              </button>
              <button type="button" onClick={() => moveExercise(index, 1)} disabled={index === dayExercises.length - 1}>
                ↓
              </button>
              <button type="button" onClick={() => removeExercise(index)} className="text-red-600">
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {showPicker ? (
        <div className="mt-2">
          <PlanExercisePicker allExercises={exerciseLibrary} onSelect={addExercise} onCancel={() => setShowPicker(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
        >
          + Add exercise to {selectedDay}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

Create `web/src/app/gym/plan/page.tsx`:

```tsx
import { getWeeklyPlanAction, listGymExercisesAction } from "@/lib/gymActions";
import { PlanBuilder } from "@/components/gym/PlanBuilder";

// This page (unlike the /gym shell) doesn't need offline support — plan
// editing is online-only by design — so it can opt into per-request
// freshness independently of that route's static shell. See
// web/src/app/gym/layout.tsx's header comment for why the shell itself
// stays static.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function GymPlanPage() {
  const [plan, exercises] = await Promise.all([getWeeklyPlanAction(), listGymExercisesAction()]);

  return (
    <div>
      <h1 className="text-lg font-semibold">Weekly Gym Plan</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Pick which days you gym and which exercises go on each day. Starting a session on a
        planned day loads these automatically.
      </p>
      <div className="mt-4">
        <PlanBuilder initialPlan={plan} allExercises={exercises} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Link it from the main gym page**

In `web/src/app/gym/page.tsx`, replace the header `div` (currently lines 12-18):

```tsx
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent sessions</h2>
          <div className="flex items-center gap-3">
            <a href="/gym/plan" className="text-xs text-neutral-500 underline">
              Plan
            </a>
            <a href="/gym/insights" className="text-xs text-neutral-500 underline">
              Insights
            </a>
          </div>
        </div>
```

- [ ] **Step 4: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual verification**

Run: `cd web && npm run dev`, open `/gym`, click "Plan". Confirm:
- Day tabs render Mon–Sun, all showing "rest day" initially.
- Selecting a day and adding a couple of exercises persists them (reload the page — they're still
  there, confirming `setPlanForDayAction` actually wrote to the database, not just local state).
- ↑/↓ reorders, "Remove" removes, and the tab's count badge updates as exercises are added/removed.
- Adding a brand-new custom exercise via "+ Add a custom exercise" works and immediately appears
  in the day's list.
- Back on `/gym`, start a session on whichever weekday today happens to be (or check the system
  clock / temporarily edit a test day's plan to match today) and confirm the session's queue seeds
  with that day's planned exercises as chips, in the saved order.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/gym/PlanBuilder.tsx web/src/app/gym/plan/page.tsx web/src/app/gym/page.tsx
git commit -m "feat: add weekly plan builder at /gym/plan"
```

---

### Task 10: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS — every test in the repo, not just the gym-related ones touched by this plan.

- [ ] **Step 2: Type-check and build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 3: End-to-end manual walkthrough**

Run: `cd web && npm run dev`. With a weekly plan already configured (from Task 9's verification):

1. Start a session on a planned day. Confirm the queue seeds correctly and the first exercise's
   card is shown.
2. Log a set. Confirm "Next exercise →" appears, and using it advances through the queue in plan
   order, skipping anything already logged if you jump around first via chip taps.
3. Tap "Swap" on the current exercise, pick a different one, confirm the chip row updates in place
   (same position, no duplicate chip) without touching the saved plan (reload `/gym/plan` afterward
   and confirm the plan itself still shows the original exercise, not the swapped one).
4. Add a brand-new custom exercise mid-session via "+ Add", log a set for it within a couple of
   seconds of creating it (the race window from the original bug), and confirm it shows correctly
   in `ActiveSessionSets` — not "Unknown exercise" — both immediately and after a page reload.
5. Start a session on a rest day (no plan). Confirm it falls back to the plain `ExercisePicker`
   with no chips shown until the first exercise is picked.
6. End the session. Confirm the "End session" button still works regardless of queue state.

- [ ] **Step 4: Fix anything found, otherwise this plan is complete**

If any step above fails, fix it as a follow-up commit in the relevant task's files — this step does
not introduce new scope, only closes out issues found in the walkthrough of what's already built.
