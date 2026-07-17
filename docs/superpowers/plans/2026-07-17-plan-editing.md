# Plan Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user move a training-plan workout to a different day within the same week, remove one, or add a new one, from the dashboard UI — no more re-uploading the whole plan CSV to reshuffle a week.

**Architecture:** `training_plan_daily` moves from a `(planned_date, session_type)` composite primary key to a surrogate `id`, so a day can hold more than one session of the same type. Three new mutations (`addDailySession`, `moveDailySession`, `deleteDailySession`) in `src/lib/db/mutations.ts`, wrapped by three shared Next.js Server Actions in a new `src/lib/planActions.ts`. `DailySessionList` becomes a client component; tapping a non-completed session opens a new `EditSessionSheet` (move/remove), and a "+ Add workout" button opens the same sheet in create mode. A one-time script migrates the live MotherDuck table to the new schema — written here, but **run only on explicit confirmation**, separately from the rest of this plan.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript, DuckDB (`@duckdb/node-api`), MotherDuck, Vitest (`node` environment, no component-rendering infra), Tailwind CSS.

## Global Constraints

- Move is scoped to **within the same week only** — no cross-week moves, no recomputation of `training_plan`'s weekly rollups across two weeks.
- A session that's `completed` (has a matched Strava activity) is **read-only**: it can't be moved, removed, or be a swap target.
- A day may hold **more than one session of the same type** after this change (e.g. two `cross_training` sessions) — this is the reason for the primary-key migration.
- Moving onto a day that already has exactly one non-completed session of the same type **swaps** the two. Moving onto a day with a completed same-type session, or two-or-more of that type, is **blocked** with an inline error.
- Every mutation is followed by `syncWeeklyFromDaily(conn)` (refresh `training_plan` rollups) and, where relevant, `correlateActivitiesToPlan(conn)` (re-match against logged activities) — done at the Server Action layer, matching the existing `importPlanCsv` action's pattern, not inside the mutation functions themselves.
- No new test infrastructure: existing tests are backend-only (`vitest`, `node` environment, in-memory DuckDB via `src/lib/db/testHelper.ts`). New UI is verified manually via the dev server, not automated component tests.
- The production MotherDuck migration is a manual, explicit, separate step — never bundled into a routine commit/deploy.

---

### Task 1: Schema migration (local/test) + `addDailySession` mutation

**Files:**
- Modify: `web/src/lib/db/schema.ts`
- Modify: `web/src/lib/db/mutations.ts`
- Modify: `web/src/app/(dashboard)/plan-history/actions.ts`
- Create: `web/src/lib/db/mutations.test.ts`

**Interfaces:**
- Produces: `addDailySession(conn: DuckDBConnection, s: DailySessionInput): Promise<number>` — inserts a new `training_plan_daily` row, returns its generated `id`. `DailySessionInput` is unchanged from the current `upsertDailySession`'s parameter shape (see below).
- Consumes: `queryRow`, `queryRows` from `./client` (already imported in `mutations.ts`).

The current `training_plan_daily` table (in `web/src/lib/db/schema.ts`) is:

```ts
`CREATE TABLE IF NOT EXISTS training_plan_daily (
    planned_date DATE,
    week_number INTEGER,
    day_of_week VARCHAR,
    session_type VARCHAR,
    planned_distance_km DOUBLE,
    intensity VARCHAR,
    description TEXT,
    is_quality BOOLEAN DEFAULT FALSE,
    completed BOOLEAN DEFAULT FALSE,
    completed_activity_id BIGINT,
    completed_distance_km DOUBLE,
    PRIMARY KEY (planned_date, session_type)
  )`,
```

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/db/mutations.test.ts`:

```ts
import type { DuckDBConnection } from "@duckdb/node-api";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestConnection } from "./testHelper";
import { addDailySession, queryPlanDay } from "./mutations";

let conn: DuckDBConnection;

beforeEach(async () => {
  conn = await createTestConnection();
});

function baseSession(overrides: Partial<Parameters<typeof addDailySession>[1]> = {}) {
  return {
    planned_date: "2026-07-20",
    week_number: 1,
    day_of_week: "Monday",
    session_type: "cross_training",
    planned_distance_km: 0,
    intensity: "easy",
    description: "Volleyball",
    is_quality: false,
    ...overrides,
  };
}

describe("addDailySession", () => {
  it("allows two sessions of the same type on the same day", async () => {
    const id1 = await addDailySession(conn, baseSession({ description: "Volleyball" }));
    const id2 = await addDailySession(conn, baseSession({ description: "Easy spin on the bike" }));

    expect(id1).not.toBe(id2);

    const rows = await queryPlanDay(conn, id1, id2);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.description).sort()).toEqual(["Easy spin on the bike", "Volleyball"]);
  });
});
```

This references a small test-only helper `queryPlanDay` that doesn't exist yet either — add it as an exported helper in `mutations.ts` (it's generally useful for the tests in later tasks too, not test-only scaffolding bolted on):

```ts
export interface PlanDayRow {
  id: number;
  planned_date: string;
  day_of_week: string;
  session_type: string;
  completed: boolean;
  description: string;
}

export async function queryPlanDay(conn: DuckDBConnection, ...ids: number[]): Promise<PlanDayRow[]> {
  return queryRows<PlanDayRow>(
    conn,
    `SELECT id, planned_date::VARCHAR AS planned_date, day_of_week, session_type, completed, description
     FROM training_plan_daily WHERE id IN (${ids.map((_, i) => `$id${i}`).join(", ")})
     ORDER BY id`,
    Object.fromEntries(ids.map((id, i) => [`id${i}`, id])),
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/db/mutations.test.ts`
Expected: FAIL — `addDailySession` and `queryPlanDay` are not exported from `./mutations` yet.

- [ ] **Step 3: Migrate the schema**

In `web/src/lib/db/schema.ts`, replace the `training_plan_daily` table statement and insert a new sequence statement right before it (following the same `CREATE SEQUENCE ... id_seq` / `CREATE TABLE ... DEFAULT nextval(...)` pattern already used for `race_events`/`training_blocks` in this same file):

```ts
  `CREATE SEQUENCE IF NOT EXISTS training_plan_daily_id_seq START 1`,
  `CREATE TABLE IF NOT EXISTS training_plan_daily (
    id INTEGER PRIMARY KEY DEFAULT nextval('training_plan_daily_id_seq'),
    planned_date DATE,
    week_number INTEGER,
    day_of_week VARCHAR,
    session_type VARCHAR,
    planned_distance_km DOUBLE,
    intensity VARCHAR,
    description TEXT,
    is_quality BOOLEAN DEFAULT FALSE,
    completed BOOLEAN DEFAULT FALSE,
    completed_activity_id BIGINT,
    completed_distance_km DOUBLE
  )`,
```

- [ ] **Step 4: Add `addDailySession` and `queryPlanDay` to `mutations.ts`**

In `web/src/lib/db/mutations.ts`, replace the existing `upsertDailySession` function (keep the `DailySessionInput` interface as-is — its shape doesn't change) with:

```ts
export async function addDailySession(conn: DuckDBConnection, s: DailySessionInput): Promise<number> {
  const row = await queryRow<{ id: number }>(
    conn,
    `INSERT INTO training_plan_daily (
      planned_date, week_number, day_of_week, session_type,
      planned_distance_km, intensity, description, is_quality
    ) VALUES ($planned_date, $week_number, $day_of_week, $session_type,
      $planned_distance_km, $intensity, $description, $is_quality)
    RETURNING id`,
    {
      planned_date: s.planned_date,
      week_number: s.week_number,
      day_of_week: s.day_of_week,
      session_type: s.session_type,
      planned_distance_km: s.planned_distance_km ?? null,
      intensity: s.intensity,
      description: s.description,
      is_quality: s.is_quality ?? false,
    },
  );
  return row!.id;
}

export interface PlanDayRow {
  id: number;
  planned_date: string;
  day_of_week: string;
  session_type: string;
  completed: boolean;
  description: string;
}

export async function queryPlanDay(conn: DuckDBConnection, ...ids: number[]): Promise<PlanDayRow[]> {
  return queryRows<PlanDayRow>(
    conn,
    `SELECT id, planned_date::VARCHAR AS planned_date, day_of_week, session_type, completed, description
     FROM training_plan_daily WHERE id IN (${ids.map((_, i) => `$id${i}`).join(", ")})
     ORDER BY id`,
    Object.fromEntries(ids.map((id, i) => [`id${i}`, id])),
  );
}
```

This follows the exact `INSERT ... RETURNING id` pattern already used by `upsertRaceEvent` in this same file (`mutations.ts:372-380`).

- [ ] **Step 5: Update the CSV import call site**

In `web/src/app/(dashboard)/plan-history/actions.ts`, change the import and the call:

```ts
import { addDailySession, clearTrainingPlan, correlateActivitiesToPlan, syncWeeklyFromDaily } from "@/lib/db/mutations";
```

```ts
    await addDailySession(conn, {
```

(Only the function name changes — the call's arguments are already exactly `DailySessionInput`-shaped, unchanged.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/db/mutations.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Run the full test suite and typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all existing tests still pass (they exercise `training_plan_daily` only through `dailyPlanForWeek`/`weeklyCompletionSummary`, neither of which reference the old composite PK directly), and no type errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/db/schema.ts web/src/lib/db/mutations.ts web/src/lib/db/mutations.test.ts "web/src/app/(dashboard)/plan-history/actions.ts"
git commit -m "feat: surrogate id PK for training_plan_daily, add addDailySession"
```

---

### Task 2: `deleteDailySession` mutation

**Files:**
- Modify: `web/src/lib/db/mutations.ts`
- Modify: `web/src/lib/db/mutations.test.ts`

**Interfaces:**
- Consumes: `queryPlanDay`, `addDailySession` (Task 1).
- Produces: `deleteDailySession(conn: DuckDBConnection, id: number): Promise<{ error?: string }>`.

- [ ] **Step 1: Write the failing tests**

Change the existing `import { addDailySession, queryPlanDay } from "./mutations";` line (added in Task 1) to also bring in `deleteDailySession`:

```ts
import { addDailySession, deleteDailySession, queryPlanDay } from "./mutations";
```

Then add below the existing `describe("addDailySession", ...)` block in `web/src/lib/db/mutations.test.ts`:

```ts
describe("deleteDailySession", () => {
  it("removes a non-completed session", async () => {
    const id = await addDailySession(conn, baseSession());
    const result = await deleteDailySession(conn, id);

    expect(result.error).toBeUndefined();
    const rows = await queryPlanDay(conn, id);
    expect(rows).toHaveLength(0);
  });

  it("refuses to remove a completed session", async () => {
    const id = await addDailySession(conn, baseSession());
    await conn.run("UPDATE training_plan_daily SET completed = TRUE WHERE id = $id", { id });

    const result = await deleteDailySession(conn, id);

    expect(result.error).toBe("Can't remove a completed session.");
    const rows = await queryPlanDay(conn, id);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/db/mutations.test.ts`
Expected: FAIL — `deleteDailySession` is not exported yet.

- [ ] **Step 3: Implement `deleteDailySession`**

Add to `web/src/lib/db/mutations.ts`:

```ts
export async function deleteDailySession(conn: DuckDBConnection, id: number): Promise<{ error?: string }> {
  const row = await queryRow<{ completed: boolean }>(
    conn,
    "SELECT completed FROM training_plan_daily WHERE id = $id",
    { id },
  );
  if (!row) return { error: "Session not found." };
  if (row.completed) return { error: "Can't remove a completed session." };

  await conn.run("DELETE FROM training_plan_daily WHERE id = $id", { id });
  return {};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/db/mutations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/db/mutations.ts web/src/lib/db/mutations.test.ts
git commit -m "feat: add deleteDailySession mutation"
```

---

### Task 3: `moveDailySession` mutation

**Files:**
- Modify: `web/src/lib/db/mutations.ts`
- Modify: `web/src/lib/db/mutations.test.ts`

**Interfaces:**
- Consumes: `queryPlanDay`, `addDailySession` (Task 1).
- Produces: `moveDailySession(conn: DuckDBConnection, id: number, toDate: string): Promise<{ error?: string }>`.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/lib/db/mutations.test.ts`:

```ts
import { moveDailySession } from "./mutations";

describe("moveDailySession", () => {
  it("moves a session to an empty day", async () => {
    const id = await addDailySession(conn, baseSession({ planned_date: "2026-07-20", day_of_week: "Monday" }));

    const result = await moveDailySession(conn, id, "2026-07-22");

    expect(result.error).toBeUndefined();
    const [row] = await queryPlanDay(conn, id);
    expect(row.planned_date).toBe("2026-07-22");
    expect(row.day_of_week).toBe("Wednesday");
  });

  it("swaps with the one existing session of the same type on the target day", async () => {
    const tuesday = await addDailySession(
      conn,
      baseSession({ planned_date: "2026-07-21", day_of_week: "Tuesday", session_type: "easy_run", description: "Tuesday run" }),
    );
    const thursday = await addDailySession(
      conn,
      baseSession({ planned_date: "2026-07-23", day_of_week: "Thursday", session_type: "easy_run", description: "Thursday run" }),
    );

    const result = await moveDailySession(conn, tuesday, "2026-07-23");

    expect(result.error).toBeUndefined();
    const rows = await queryPlanDay(conn, tuesday, thursday);
    const movedToThursday = rows.find((r) => r.id === tuesday)!;
    const movedToTuesday = rows.find((r) => r.id === thursday)!;
    expect(movedToThursday.planned_date).toBe("2026-07-23");
    expect(movedToThursday.day_of_week).toBe("Thursday");
    expect(movedToTuesday.planned_date).toBe("2026-07-21");
    expect(movedToTuesday.day_of_week).toBe("Tuesday");
  });

  it("blocks moving a completed session", async () => {
    const id = await addDailySession(conn, baseSession({ planned_date: "2026-07-20" }));
    await conn.run("UPDATE training_plan_daily SET completed = TRUE WHERE id = $id", { id });

    const result = await moveDailySession(conn, id, "2026-07-22");

    expect(result.error).toBe("Can't move a completed session.");
    const [row] = await queryPlanDay(conn, id);
    expect(row.planned_date).toBe("2026-07-20");
  });

  it("blocks moving onto a day whose same-type session is completed", async () => {
    const source = await addDailySession(conn, baseSession({ planned_date: "2026-07-20", session_type: "easy_run" }));
    const target = await addDailySession(conn, baseSession({ planned_date: "2026-07-22", session_type: "easy_run" }));
    await conn.run("UPDATE training_plan_daily SET completed = TRUE WHERE id = $id", { id: target });

    const result = await moveDailySession(conn, source, "2026-07-22");

    expect(result.error).toBe("That day's session is already completed and can't be replaced.");
    const [row] = await queryPlanDay(conn, source);
    expect(row.planned_date).toBe("2026-07-20");
  });

  it("blocks moving onto a day that already has two or more sessions of that type", async () => {
    const source = await addDailySession(conn, baseSession({ planned_date: "2026-07-20", session_type: "cross_training" }));
    await addDailySession(conn, baseSession({ planned_date: "2026-07-22", session_type: "cross_training", description: "Volleyball" }));
    await addDailySession(conn, baseSession({ planned_date: "2026-07-22", session_type: "cross_training", description: "Cycling" }));

    const result = await moveDailySession(conn, source, "2026-07-22");

    expect(result.error).toBe("That day already has 2 cross training sessions — remove one first or pick a different day.");
    const [row] = await queryPlanDay(conn, source);
    expect(row.planned_date).toBe("2026-07-20");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/db/mutations.test.ts`
Expected: FAIL — `moveDailySession` is not exported yet.

- [ ] **Step 3: Implement `moveDailySession`**

Add to `web/src/lib/db/mutations.ts`:

```ts
export async function moveDailySession(conn: DuckDBConnection, id: number, toDate: string): Promise<{ error?: string }> {
  const source = await queryRow<{
    id: number;
    session_type: string;
    completed: boolean;
    planned_date: string;
    day_of_week: string;
  }>(
    conn,
    `SELECT id, session_type, completed, planned_date::VARCHAR AS planned_date, day_of_week
     FROM training_plan_daily WHERE id = $id`,
    { id },
  );
  if (!source) return { error: "Session not found." };
  if (source.completed) return { error: "Can't move a completed session." };

  const dayOfWeek = new Date(`${toDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });

  const collisions = await queryRows<{ id: number; completed: boolean }>(
    conn,
    `SELECT id, completed FROM training_plan_daily
     WHERE planned_date = $to_date AND session_type = $session_type AND id != $id`,
    { to_date: toDate, session_type: source.session_type, id },
  );

  if (collisions.length > 1) {
    return {
      error: `That day already has ${collisions.length} ${source.session_type.replace(/_/g, " ")} sessions — remove one first or pick a different day.`,
    };
  }
  if (collisions.length === 1 && collisions[0].completed) {
    return { error: "That day's session is already completed and can't be replaced." };
  }

  await conn.run("BEGIN TRANSACTION");
  try {
    if (collisions.length === 1) {
      await conn.run(
        "UPDATE training_plan_daily SET planned_date = $planned_date, day_of_week = $day_of_week WHERE id = $id",
        { planned_date: source.planned_date, day_of_week: source.day_of_week, id: collisions[0].id },
      );
    }
    await conn.run(
      "UPDATE training_plan_daily SET planned_date = $to_date, day_of_week = $day_of_week WHERE id = $id",
      { to_date: toDate, day_of_week: dayOfWeek, id },
    );
    await conn.run("COMMIT");
  } catch (err) {
    await conn.run("ROLLBACK");
    throw err;
  }

  return {};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/db/mutations.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/db/mutations.ts web/src/lib/db/mutations.test.ts
git commit -m "feat: add moveDailySession mutation with same-week swap semantics"
```

---

### Task 4: Expose `id` on `DailyPlanRow`

**Files:**
- Modify: `web/src/lib/metrics.ts`
- Modify: `web/src/lib/metrics.test.ts`

**Interfaces:**
- Consumes: `addDailySession` (Task 1) for the new test's fixture data.
- Produces: `DailyPlanRow.id: number`; `dailyPlanForWeek` now selects it.

- [ ] **Step 1: Write the failing test**

Add to `web/src/lib/metrics.test.ts` (near the other `describe` blocks; `upsertTrainingPlanWeek` and `addDailySession` need to be added to the existing `mutations` import at the top of the file):

```ts
import {
  upsertActivity,
  upsertStreamsDerived,
  upsertGear,
  upsertTrainingPlanWeek,
  upsertRaceEvent,
  upsertRaceAnalysis,
  addDailySession,
} from "./db/mutations";
```

```ts
describe("dailyPlanForWeek", () => {
  it("includes each session's id", async () => {
    await upsertTrainingPlanWeek(conn, {
      week_number: 1,
      week_start_date: "2026-07-20",
      phase: "Base",
      planned_distance_km: 10,
      planned_long_run_km: 10,
      planned_sessions: 1,
      is_deload: false,
    });
    const id = await addDailySession(conn, {
      planned_date: "2026-07-20",
      week_number: 1,
      day_of_week: "Monday",
      session_type: "easy_run",
      planned_distance_km: 8,
      intensity: "easy",
      description: "Easy run",
    });

    const rows = await metrics.dailyPlanForWeek(conn, 1);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
  });
});
```

(Check `upsertTrainingPlanWeek`'s exact parameter shape in `web/src/lib/db/mutations.ts` before writing this — it's already imported and used elsewhere in this test file, so match whatever fields the existing tests pass it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/metrics.test.ts -t dailyPlanForWeek`
Expected: FAIL — `rows[0].id` is `undefined` (property doesn't exist on the query result).

- [ ] **Step 3: Add `id` to `DailyPlanRow` and the query**

In `web/src/lib/metrics.ts`, update the interface and query (currently at `metrics.ts:671-703`):

```ts
export interface DailyPlanRow {
  id: number;
  planned_date: string;
  day_of_week: string;
  session_type: string;
  planned_km: number | null;
  intensity: string;
  is_quality: boolean;
  completed: boolean;
  actual_km: number | null;
  completed_activity_id: number | null;
  description: string;
}

export async function dailyPlanForWeek(conn: DuckDBConnection, weekNumber: number): Promise<DailyPlanRow[]> {
  return queryRows<DailyPlanRow>(
    conn,
    `SELECT
        id,
        planned_date::VARCHAR AS planned_date,
        day_of_week,
        session_type,
        ROUND(planned_distance_km, 1) AS planned_km,
        intensity,
        is_quality,
        completed,
        ROUND(completed_distance_km, 1) AS actual_km,
        completed_activity_id::DOUBLE AS completed_activity_id,
        description
     FROM training_plan_daily
     WHERE week_number = $week_number
     ORDER BY planned_date`,
    { week_number: weekNumber },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/metrics.test.ts -t dailyPlanForWeek`
Expected: PASS.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all pass, no type errors — adding a new field to `DailyPlanRow` doesn't affect existing consumers (`DailySessionList.tsx` still keys rows by `${row.planned_date}-${row.session_type}`; that's only replaced with `row.id` in Task 8, once the UI actually needs it as a mutation target).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/metrics.ts web/src/lib/metrics.test.ts
git commit -m "feat: expose id on DailyPlanRow / dailyPlanForWeek"
```

---

### Task 5: `shared.ts` — `cross_training` icon + `weekDates` helper

**Files:**
- Modify: `web/src/lib/shared.ts`
- Create: `web/src/lib/shared.test.ts`

**Interfaces:**
- Produces: `SESSION_ICON.cross_training`; `weekDates(weekStartDate: string): WeekDate[]` where `WeekDate = { date: string; dayName: string }`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/shared.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SESSION_ICON, weekDates } from "./shared";

describe("SESSION_ICON", () => {
  it("has a distinct icon for cross_training (not the rest fallback)", () => {
    expect(SESSION_ICON.cross_training).toBeDefined();
    expect(SESSION_ICON.cross_training).not.toBe(SESSION_ICON.rest);
  });
});

describe("weekDates", () => {
  it("returns the 7 calendar dates and weekday names starting from week_start_date", () => {
    const days = weekDates("2026-07-20");

    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ date: "2026-07-20", dayName: "Monday" });
    expect(days[6]).toEqual({ date: "2026-07-26", dayName: "Sunday" });
  });

  it("rolls over correctly across a month boundary", () => {
    const days = weekDates("2026-07-27");
    expect(days[6]).toEqual({ date: "2026-08-02", dayName: "Sunday" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/shared.test.ts`
Expected: FAIL — `weekDates` is not exported yet, and `SESSION_ICON.cross_training` is `undefined`.

- [ ] **Step 3: Implement both**

In `web/src/lib/shared.ts`, add `cross_training` to `SESSION_ICON`:

```ts
export const SESSION_ICON: Record<string, string> = {
  rest: "⬜",
  sc: "\u{1F4AA}",
  easy_run: "\u{1F7E2}",
  quality_run: "\u{1F7E1}",
  long_run: "\u{1F535}",
  hills: "\u{1F7E0}",
  cross_training: "\u{1F6B4}",
  cricket: "\u{1F3CF}",
  race: "\u{1F3C6}",
};
```

Add the `weekDates` helper (near `shortDate`/`weekLabel`, following the same "build the Date from Y/M/D components directly" pattern used there to avoid the UTC-midnight timezone bug):

```ts
export interface WeekDate {
  date: string;
  dayName: string;
}

export function weekDates(weekStartDate: string): WeekDate[] {
  const [y, m, d] = weekStartDate.slice(0, 10).split("-").map(Number);
  const start = new Date(y, m - 1, d);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start.getTime());
    day.setDate(day.getDate() + i);
    const yyyy = day.getFullYear();
    const mm = String(day.getMonth() + 1).padStart(2, "0");
    const dd = String(day.getDate()).padStart(2, "0");
    return {
      date: `${yyyy}-${mm}-${dd}`,
      dayName: day.toLocaleDateString("en-US", { weekday: "long" }),
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/shared.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/shared.ts web/src/lib/shared.test.ts
git commit -m "feat: add cross_training icon and weekDates helper"
```

---

### Task 6: Shared server actions (`planActions.ts`)

**Files:**
- Create: `web/src/lib/planActions.ts`

**Interfaces:**
- Consumes: `addDailySession`, `moveDailySession`, `deleteDailySession`, `syncWeeklyFromDaily`, `correlateActivitiesToPlan` (from `./db/mutations`); `getConnection` (from `./db/client`); `DASHBOARD_DATA_TAG` (from `./pageData`).
- Produces: `PlanActionState = { error?: string }`; `moveDailySessionAction(id: number, toDate: string): Promise<PlanActionState>`; `deleteDailySessionAction(id: number): Promise<PlanActionState>`; `addDailySessionAction(formData: FormData): Promise<PlanActionState>`.

This is thin orchestration glue over already-tested mutations (Tasks 1-3) — following the existing project convention, `actions.ts` files (`plan-history/actions.ts`, `race-prep/actions.ts`) don't have dedicated tests; they're verified manually once wired into the UI (Task 9). No test file for this task.

- [ ] **Step 1: Write the file**

Create `web/src/lib/planActions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { updateTag } from "next/cache";
import { getConnection } from "./db/client";
import {
  addDailySession,
  correlateActivitiesToPlan,
  deleteDailySession,
  moveDailySession,
  syncWeeklyFromDaily,
  type DailySessionInput,
} from "./db/mutations";
import { DASHBOARD_DATA_TAG } from "./pageData";

export interface PlanActionState {
  error?: string;
}

function revalidatePlanPages(): void {
  updateTag(DASHBOARD_DATA_TAG);
  revalidatePath("/today");
  revalidatePath("/plan-history");
}

export async function moveDailySessionAction(id: number, toDate: string): Promise<PlanActionState> {
  const conn = await getConnection();
  const result = await moveDailySession(conn, id, toDate);
  if (result.error) return result;

  await syncWeeklyFromDaily(conn);
  await correlateActivitiesToPlan(conn);
  revalidatePlanPages();
  return {};
}

export async function deleteDailySessionAction(id: number): Promise<PlanActionState> {
  const conn = await getConnection();
  const result = await deleteDailySession(conn, id);
  if (result.error) return result;

  await syncWeeklyFromDaily(conn);
  revalidatePlanPages();
  return {};
}

export async function addDailySessionAction(formData: FormData): Promise<PlanActionState> {
  const plannedDate = String(formData.get("planned_date") ?? "");
  const sessionType = String(formData.get("session_type") ?? "");
  const weekNumberRaw = String(formData.get("week_number") ?? "");
  const weekNumber = Number(weekNumberRaw);

  if (!plannedDate || !sessionType) return { error: "Day and session type are required." };
  if (!weekNumberRaw || Number.isNaN(weekNumber)) return { error: "Missing week number." };

  const dayOfWeek = new Date(`${plannedDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  const input: DailySessionInput = {
    planned_date: plannedDate,
    week_number: weekNumber,
    day_of_week: dayOfWeek,
    session_type: sessionType,
    planned_distance_km: Number(formData.get("planned_distance_km") ?? 0) || 0,
    intensity: String(formData.get("intensity") ?? "easy"),
    description: String(formData.get("description") ?? ""),
    is_quality: formData.get("is_quality") === "on",
  };

  const conn = await getConnection();
  await addDailySession(conn, input);
  await syncWeeklyFromDaily(conn);
  await correlateActivitiesToPlan(conn);
  revalidatePlanPages();
  return {};
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/planActions.ts
git commit -m "feat: add shared server actions for moving/removing/adding plan sessions"
```

---

### Task 7: `EditSessionSheet` component

**Files:**
- Create: `web/src/components/EditSessionSheet.tsx`

**Interfaces:**
- Consumes: `moveDailySessionAction`, `deleteDailySessionAction`, `addDailySessionAction` (Task 6); `SESSION_ICON`, `INTENSITY_LABEL`, `WeekDate` (Task 5); `DailyPlanRow` (Task 4).
- Produces: `EditSessionSheet` component, used by `DailySessionList` in Task 8.

- [ ] **Step 1: Write the component**

Create `web/src/components/EditSessionSheet.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { addDailySessionAction, deleteDailySessionAction, moveDailySessionAction } from "@/lib/planActions";
import { INTENSITY_LABEL, SESSION_ICON, type WeekDate } from "@/lib/shared";
import type { DailyPlanRow } from "@/lib/metrics";

const SESSION_TYPES = ["rest", "sc", "easy_run", "quality_run", "long_run", "hills", "cross_training", "cricket", "race"];
const INTENSITIES = ["easy", "moderate", "hard", "race", "rest"];

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

type Props =
  | { mode: "edit"; session: DailyPlanRow; daily: DailyPlanRow[]; weekDates: WeekDate[]; onClose: () => void }
  | { mode: "create"; weekNumber: number; daily: DailyPlanRow[]; weekDates: WeekDate[]; onClose: () => void };

function targetDayState(
  daily: DailyPlanRow[],
  date: string,
  sessionType: string,
  ownId: number,
): { disabled: boolean; reason: string | null } {
  const sameType = daily.filter((d) => d.planned_date === date && d.session_type === sessionType && d.id !== ownId);
  if (sameType.length > 1) {
    return { disabled: true, reason: `Already has ${sameType.length} ${sessionType.replace(/_/g, " ")} sessions` };
  }
  if (sameType.length === 1 && sameType[0].completed) {
    return { disabled: true, reason: "Already completed" };
  }
  return { disabled: false, reason: null };
}

export function EditSessionSheet(props: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleMove(toDate: string) {
    if (props.mode !== "edit") return;
    setError(null);
    startTransition(async () => {
      const result = await moveDailySessionAction(props.session.id, toDate);
      if (result.error) setError(result.error);
      else props.onClose();
    });
  }

  function handleRemove() {
    if (props.mode !== "edit") return;
    setError(null);
    startTransition(async () => {
      const result = await deleteDailySessionAction(props.session.id);
      if (result.error) setError(result.error);
      else props.onClose();
    });
  }

  function handleCreate(formData: FormData) {
    if (props.mode !== "create") return;
    setError(null);
    formData.set("week_number", String(props.weekNumber));
    startTransition(async () => {
      const result = await addDailySessionAction(formData);
      if (result.error) setError(result.error);
      else props.onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={props.onClose}>
      <div
        className="w-full max-w-3xl rounded-t-xl bg-white p-4 dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        {props.mode === "edit" ? (
          <>
            <h3 className="text-sm font-medium">
              {SESSION_ICON[props.session.session_type] ?? "⬜"} {props.session.session_type.replace(/_/g, " ")}
            </h3>
            {props.session.description && (
              <p className="mt-1 text-sm text-neutral-500">{props.session.description}</p>
            )}

            <p className="mt-3 text-xs text-neutral-500">Move to</p>
            <div className="mt-1 grid grid-cols-4 gap-1.5">
              {props.weekDates.map((wd) => {
                const isOwnDay = wd.date === props.session.planned_date;
                const { disabled, reason } = isOwnDay
                  ? { disabled: true, reason: null }
                  : targetDayState(props.daily, wd.date, props.session.session_type, props.session.id);
                return (
                  <button
                    key={wd.date}
                    type="button"
                    disabled={disabled || isPending}
                    title={reason ?? undefined}
                    onClick={() => handleMove(wd.date)}
                    className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs disabled:opacity-40 dark:border-neutral-700"
                  >
                    {wd.dayName.slice(0, 3)}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={isPending}
              onClick={handleRemove}
              className="mt-4 w-full rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 dark:border-red-900"
            >
              Remove from plan
            </button>
          </>
        ) : (
          <form action={handleCreate} className="space-y-2">
            <h3 className="text-sm font-medium">Add workout</h3>
            <select name="planned_date" required className={FIELD_CLASS}>
              {props.weekDates.map((wd) => (
                <option key={wd.date} value={wd.date}>
                  {wd.dayName} ({wd.date})
                </option>
              ))}
            </select>
            <select name="session_type" required className={FIELD_CLASS}>
              {SESSION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <input name="planned_distance_km" type="number" step="0.1" min="0" placeholder="Distance (km)" className={FIELD_CLASS} />
            <select name="intensity" required className={FIELD_CLASS}>
              {INTENSITIES.map((i) => (
                <option key={i} value={i}>
                  {INTENSITY_LABEL[i]}
                </option>
              ))}
            </select>
            <input name="description" placeholder="Description" className={FIELD_CLASS} />
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              Add
            </button>
          </form>
        )}

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <button type="button" onClick={props.onClose} className="mt-3 w-full text-center text-xs text-neutral-500">
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `cd web && npx tsc --noEmit && npx eslint src/components/EditSessionSheet.tsx`
Expected: no errors. (Not yet imported anywhere, so no visual verification possible until Task 8 — that's expected for this task.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/EditSessionSheet.tsx
git commit -m "feat: add EditSessionSheet component (move/remove/add)"
```

---

### Task 8: `DailySessionList` becomes interactive

**Files:**
- Modify: `web/src/components/DailySessionList.tsx`

**Interfaces:**
- Consumes: `EditSessionSheet` (Task 7); `weekDates` (Task 5); `DailyPlanRow.id` (Task 4).
- Produces: `DailySessionList` now takes `weekStartDate: string` and `weekNumber: number` props in addition to the existing `daily`/`today`.

The current file is `web/src/components/DailySessionList.tsx` (55 lines, read in full during design — the `<li>` rendering body doesn't change here, only the wrapping/keying/interactivity around it).

- [ ] **Step 1: Rewrite the component**

Replace the full contents of `web/src/components/DailySessionList.tsx` with:

```tsx
"use client";
import { useState } from "react";
import { INTENSITY_LABEL, SESSION_ICON, weekDates } from "@/lib/shared";
import { EditSessionSheet } from "@/components/EditSessionSheet";
import type { DailyPlanRow } from "@/lib/metrics";

function statusIcon(row: DailyPlanRow, today: string): string {
  if (row.completed) return "✅";
  return row.planned_date >= today ? "⏳" : "❌";
}

export function DailySessionList({
  daily,
  today,
  weekStartDate,
  weekNumber,
}: {
  daily: DailyPlanRow[];
  today: string;
  weekStartDate: string;
  weekNumber: number;
}) {
  const [editing, setEditing] = useState<DailyPlanRow | null>(null);
  const [adding, setAdding] = useState(false);
  const dates = weekDates(weekStartDate);

  return (
    <>
      {daily.length === 0 ? (
        <p className="text-sm text-neutral-500">No sessions loaded for this week.</p>
      ) : (
        <ul className="space-y-2">
          {daily.map((row) => {
            const icon = SESSION_ICON[row.session_type] ?? "⬜";
            const effort = INTENSITY_LABEL[row.intensity] ?? row.intensity;
            const dayName = row.day_of_week.slice(0, 3);
            const dateLabel = new Date(`${row.planned_date}T00:00:00`).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            const editable = !row.completed;
            return (
              <li
                key={row.id}
                onClick={editable ? () => setEditing(row) : undefined}
                className={`rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800 ${
                  editable ? "cursor-pointer" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span aria-hidden="true">{statusIcon(row, today)}</span>
                    <span className="text-sm font-medium">
                      {dayName} {dateLabel}
                    </span>
                  </div>
                  <div className="text-right text-sm">
                    <div>{row.planned_km && row.planned_km > 0 ? `${row.planned_km} km` : "—"}</div>
                    {row.actual_km != null && (
                      <div className="text-neutral-500">{row.actual_km} km actual</div>
                    )}
                  </div>
                </div>
                <div className="mt-1 text-sm">
                  {icon} {row.session_type.replace(/_/g, " ")}{" "}
                  <span className="text-neutral-500">· {effort}</span>
                </div>
                {row.description && (
                  <p className="mt-1 text-sm text-neutral-500">{row.description}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-2 w-full rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700"
      >
        + Add workout
      </button>

      {editing && (
        <EditSessionSheet
          mode="edit"
          session={editing}
          daily={daily}
          weekDates={dates}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && (
        <EditSessionSheet
          mode="create"
          weekNumber={weekNumber}
          daily={daily}
          weekDates={dates}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: errors in `today/page.tsx` and `WeekExplorer.tsx` — both call `<DailySessionList daily={...} today={...} />` without the two new required props. Expected and fixed in Task 9.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DailySessionList.tsx
git commit -m "feat: make DailySessionList interactive (tap-to-edit, add workout)"
```

---

### Task 9: Wire the pages

**Files:**
- Modify: `web/src/app/(dashboard)/today/page.tsx`
- Modify: `web/src/components/WeekExplorer.tsx`

**Interfaces:**
- Consumes: `DailySessionList`'s new `weekStartDate`/`weekNumber` props (Task 8).

- [ ] **Step 1: Update `today/page.tsx`**

In `web/src/app/(dashboard)/today/page.tsx`, replace:

```tsx
      {daily.length === 0 ? (
        <p className="text-sm text-neutral-500">No daily sessions yet for this week.</p>
      ) : (
        <DailySessionList daily={daily} today={today} />
      )}
```

with:

```tsx
      <DailySessionList
        daily={daily}
        today={today}
        weekStartDate={current.week_start_date}
        weekNumber={current.week_number}
      />
```

(`DailySessionList` now renders its own "No sessions loaded for this week." message when `daily` is empty — see Task 8 — so the page no longer needs its own empty-state branch here, and the Add-workout button is available even on an empty week.)

- [ ] **Step 2: Update `WeekExplorer.tsx`**

In `web/src/components/WeekExplorer.tsx`, replace:

```tsx
      <div className="mt-3">
        <DailySessionList daily={dailyByWeek[selected] ?? []} today={today} />
      </div>
```

with:

```tsx
      <div className="mt-3">
        <DailySessionList
          daily={dailyByWeek[selected] ?? []}
          today={today}
          weekStartDate={row?.week_start_date ?? ""}
          weekNumber={selected}
        />
      </div>
```

- [ ] **Step 3: Typecheck, lint, run full test suite, build**

Run: `cd web && npx tsc --noEmit && npx eslint src/ && npx vitest run && npx next build --webpack`
Expected: all pass, build succeeds.

- [ ] **Step 4: Manual verification**

Run: `cd web && npm run dev`, open the dashboard, log in.

- On **Today**: tap a non-completed session → sheet opens showing its details and a row of day buttons; tap a different day → sheet closes, session moves (confirm on reload or via the "Last synced"-adjacent day change). Tap a completed session (if one exists this week) → nothing happens (no sheet, no cursor change). Tap "+ Add workout" → fill the form, submit → new session appears in the list.
- On **Plan & History → week explorer**: switch to a week with two sessions of the same type (or add one via Task's Add flow to create that scenario) → open one of them → the other day should show a "Already has 2 …" tooltip/disabled state if you also add a third; opening a normal duplicate pair should let you move either one elsewhere freely (only 2+ on the *target* day blocks).
- Confirm the `cross_training` icon (🚴 or as picked) now shows instead of the generic ⬜ for cross-training sessions.

- [ ] **Step 5: Commit**

```bash
git add "web/src/app/(dashboard)/today/page.tsx" web/src/components/WeekExplorer.tsx
git commit -m "feat: wire plan editing into Today and Plan & History pages"
```

---

### Task 10: Production migration script (write only — do not run)

**Files:**
- Create: `web/scripts/migrate-training-plan-daily-pk.ts`

**Interfaces:** none (standalone script, no imports from the app, matching `scripts/migrate-to-motherduck.ts`'s existing "no dependency on the app's TS module graph" convention).

- [ ] **Step 1: Write the script**

Create `web/scripts/migrate-training-plan-daily-pk.ts`:

```ts
// One-time migration: switch training_plan_daily's primary key from
// (planned_date, session_type) to a surrogate `id`, so a day can hold more
// than one session of the same type (e.g. two cross_training sessions).
// Run once against the live MotherDuck database. NOT part of the deployed
// app — do not run this until the app code from this plan is ready to
// deploy alongside it (the new app code queries an `id` column that only
// exists after this script runs).
//
// Usage:
//   MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
//     node scripts/migrate-training-plan-daily-pk.ts
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

  const beforeReader = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM md.training_plan_daily");
  const beforeCount = beforeReader.getRowObjectsJS()[0].n;
  console.log(`training_plan_daily currently has ${beforeCount} rows`);

  console.log("Creating id sequence and new table shape");
  await conn.run("CREATE SEQUENCE IF NOT EXISTS md.training_plan_daily_id_seq START 1");
  await conn.run(`
    CREATE TABLE md.training_plan_daily_new (
      id INTEGER PRIMARY KEY DEFAULT nextval('md.training_plan_daily_id_seq'),
      planned_date DATE,
      week_number INTEGER,
      day_of_week VARCHAR,
      session_type VARCHAR,
      planned_distance_km DOUBLE,
      intensity VARCHAR,
      description TEXT,
      is_quality BOOLEAN DEFAULT FALSE,
      completed BOOLEAN DEFAULT FALSE,
      completed_activity_id BIGINT,
      completed_distance_km DOUBLE
    )
  `);

  console.log("Copying rows across (generating ids)");
  await conn.run(`
    INSERT INTO md.training_plan_daily_new (
      planned_date, week_number, day_of_week, session_type, planned_distance_km,
      intensity, description, is_quality, completed, completed_activity_id, completed_distance_km
    )
    SELECT
      planned_date, week_number, day_of_week, session_type, planned_distance_km,
      intensity, description, is_quality, completed, completed_activity_id, completed_distance_km
    FROM md.training_plan_daily
  `);

  const afterReader = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM md.training_plan_daily_new");
  const afterCount = afterReader.getRowObjectsJS()[0].n;
  console.log(`training_plan_daily_new now has ${afterCount} rows`);

  if (beforeCount !== afterCount) {
    console.error(`Row count mismatch: before=${beforeCount} after=${afterCount} — aborting before touching the old table.`);
    conn.closeSync();
    process.exit(1);
  }

  console.log("Swapping tables");
  await conn.run("DROP TABLE md.training_plan_daily");
  await conn.run("ALTER TABLE md.training_plan_daily_new RENAME TO training_plan_daily");

  conn.closeSync();
  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors. **Do not run this script now** — running it requires the production `MOTHERDUCK_DATABASE_URL`/token and modifies the live database. That's a separate, explicit step outside this plan (see the plan's closing note).

- [ ] **Step 3: Commit**

```bash
git add web/scripts/migrate-training-plan-daily-pk.ts
git commit -m "feat: add one-time MotherDuck migration script for training_plan_daily's surrogate id PK"
```

---

### Task 11: Final integration pass

**Files:** none new — verification only.

- [ ] **Step 1: Full verification sweep**

Run, from `web/`:

```bash
npx tsc --noEmit
npx eslint src/
npx vitest run
npx next build --webpack
```

Expected: all four succeed with no errors.

- [ ] **Step 2: Re-confirm the manual walkthrough from Task 9, Step 4** covering: move (empty target), move (swap), move (blocked — completed target), move (blocked — 2+ same-type on target), remove (non-completed succeeds), remove (completed session has no tap affordance at all so this can't be attempted from the UI), add (to an empty day, to a day that already has other sessions, and to a day that already has a same-type session — confirming it *adds* rather than overwrites).

- [ ] **Step 3: Do not commit code in this task** — it's verification only. If Step 1 or 2 surface an issue, fix it within the task where the bug actually lives (Tasks 1-10) and re-run this task's checks.

---

## Before deploying

This plan changes `training_plan_daily`'s schema. The order matters:

1. Get every task above reviewed and merged.
2. **Run `web/scripts/migrate-training-plan-daily-pk.ts` against production MotherDuck first**, with `MOTHERDUCK_DATABASE_URL` pointing at the real database — confirm explicitly before doing this, the same way deploys have been gated throughout this project.
3. Only then deploy the app code. Deploying the new code (which queries `training_plan_daily.id`) before the migration runs will break the live dashboard, since that column won't exist yet.
