# Recent Activity Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual/webhook sync pick up post-hoc edits (title, description, gear/shoe reassignment) made on Strava to already-synced activities, and store `description` for the first time.

**Architecture:** `runSync` (`web/src/lib/strava/sync.ts`) gains a new step, `refreshRecentActivities`, that re-fetches full detail (via a new `getActivityById` client call) for the N most recently stored activities and upserts only the ones where name/description/gear_id actually changed. `refreshGear` is extended to also write the resolved gear name onto `activities.gear_name` (previously only the standalone `gear` table was updated — a pre-existing bug). `description` is added end-to-end: Strava response type, parser, DB column, upsert.

**Tech Stack:** Next.js (Node runtime), DuckDB (`@duckdb/node-api`) / MotherDuck, vitest.

## Global Constraints

- DuckDB column additions to an already-live table (MotherDuck production) require `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — `CREATE TABLE IF NOT EXISTS` alone does not add columns to an existing table.
- `activities.gear_name` must stay in sync with the `gear` table's `name` — this is a pre-existing gap (fixed here as part of this feature, see Task 3/Task 8).
- Recent-activity refresh count comes from env var `STRAVA_RECENT_REFRESH_COUNT`, default `5` — no UI control.
- Only `name`, `description`, `gear_id` are compared to decide whether to re-upsert a recent activity — these are the only fields Strava lets you edit post-hoc.
- Follow existing test conventions: vitest, `createTestConnection()` from `web/src/lib/db/testHelper.ts`, DB-only functions get unit tests; thin network-fetch wrappers (like the existing `getGear`, `getActivities`) are not unit-tested — match that convention for the new `getActivityById`.

---

### Task 1: `description` column on `activities`

**Files:**
- Modify: `web/src/lib/db/schema.ts:6-25` (the `activities` `CREATE TABLE` statement), and add one new statement to `SCHEMA_STATEMENTS`
- Test: `web/src/lib/db/schema.test.ts` (new)

**Interfaces:**
- Produces: `activities.description` column (`TEXT`, nullable), available to every later task.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/db/schema.test.ts`:

```ts
import { DuckDBConnection } from "@duckdb/node-api";
import { describe, expect, it } from "vitest";
import { createTestConnection } from "./testHelper";
import { initSchema } from "./schema";
import { queryRows } from "./client";

describe("activities schema", () => {
  it("has a description column", async () => {
    const conn: DuckDBConnection = await createTestConnection();
    const cols = await queryRows<{ column_name: string }>(
      conn,
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'activities'",
    );
    expect(cols.map((c) => c.column_name)).toContain("description");
  });

  it("running initSchema twice does not error (ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent)", async () => {
    const conn: DuckDBConnection = await createTestConnection();
    await expect(initSchema((sql) => conn.run(sql))).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/db/schema.test.ts`
Expected: FAIL — `description` not in `cols`.

- [ ] **Step 3: Add the column**

In `web/src/lib/db/schema.ts`, add `description TEXT,` to the `activities` `CREATE TABLE IF NOT EXISTS` statement (after `gear_name VARCHAR,`, before `synced_at`):

```ts
  `CREATE TABLE IF NOT EXISTS activities (
    id BIGINT PRIMARY KEY,
    name VARCHAR,
    sport_type VARCHAR,
    category VARCHAR,
    start_date_local TIMESTAMP,
    distance_km DOUBLE,
    moving_time_min DOUBLE,
    elapsed_time_min DOUBLE,
    elevation_gain_m DOUBLE,
    average_heartrate DOUBLE,
    max_heartrate DOUBLE,
    average_cadence DOUBLE,
    average_speed_kmh DOUBLE,
    relative_effort DOUBLE,
    load_score DOUBLE,
    gear_id VARCHAR,
    gear_name VARCHAR,
    description TEXT,
    synced_at TIMESTAMP DEFAULT current_timestamp
  )`,
```

Then add a new statement right after it in `SCHEMA_STATEMENTS`, so the column also lands on the already-live MotherDuck table (which the `CREATE TABLE IF NOT EXISTS` above will not touch, since the table already exists there):

```ts
  `ALTER TABLE activities ADD COLUMN IF NOT EXISTS description TEXT`,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/db/schema.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/db/schema.ts web/src/lib/db/schema.test.ts
git commit -m "feat: add description column to activities"
```

---

### Task 2: `description` on `ActivityInput` and `upsertActivity`

**Files:**
- Modify: `web/src/lib/db/mutations.ts:5-74`
- Test: `web/src/lib/db/mutations.test.ts`

**Interfaces:**
- Consumes: `activities.description` column (Task 1).
- Produces: `ActivityInput.description?: string | null`, persisted by `upsertActivity`. Later tasks (parser, sync) read/write this field.

- [ ] **Step 1: Write the failing test**

Add to `web/src/lib/db/mutations.test.ts` (needs `queryRow` from `./client`, already imported; add `activities` query):

```ts
describe("upsertActivity", () => {
  it("persists and updates description", async () => {
    await upsertActivity(conn, {
      id: 9001,
      name: "Morning Run",
      start_date_local: "2026-07-20T06:00:00",
      description: "Felt great",
    });

    let row = await queryRow<{ description: string | null }>(
      conn,
      "SELECT description FROM activities WHERE id = $id",
      { id: 9001 },
    );
    expect(row?.description).toBe("Felt great");

    await upsertActivity(conn, {
      id: 9001,
      name: "Morning Run",
      start_date_local: "2026-07-20T06:00:00",
      description: "Edited on Strava",
    });

    row = await queryRow<{ description: string | null }>(
      conn,
      "SELECT description FROM activities WHERE id = $id",
      { id: 9001 },
    );
    expect(row?.description).toBe("Edited on Strava");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/db/mutations.test.ts -t "persists and updates description"`
Expected: FAIL with a TypeScript error (`description` not a known property of `ActivityInput`) or the column silently not updating.

- [ ] **Step 3: Add `description` to `ActivityInput` and `upsertActivity`**

In `web/src/lib/db/mutations.ts`, add to the `ActivityInput` interface (after `gear_name`):

```ts
  gear_name?: string | null;
  description?: string | null;
}
```

Update the `upsertActivity` SQL — insert column list, values, and `ON CONFLICT` clause (add `description` right after `gear_name` in all three places), and the bound params object:

```ts
export async function upsertActivity(conn: DuckDBConnection, a: ActivityInput): Promise<void> {
  await conn.run(
    `INSERT INTO activities (
      id, name, sport_type, category, start_date_local,
      distance_km, moving_time_min, elapsed_time_min, elevation_gain_m,
      average_heartrate, max_heartrate, average_cadence, average_speed_kmh,
      relative_effort, load_score, gear_id, gear_name, description, synced_at
    ) VALUES ($id, $name, $sport_type, $category, $start_date_local,
      $distance_km, $moving_time_min, $elapsed_time_min, $elevation_gain_m,
      $average_heartrate, $max_heartrate, $average_cadence, $average_speed_kmh,
      $relative_effort, $load_score, $gear_id, $gear_name, $description, now())
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      sport_type = excluded.sport_type,
      category = excluded.category,
      start_date_local = excluded.start_date_local,
      distance_km = excluded.distance_km,
      moving_time_min = excluded.moving_time_min,
      elapsed_time_min = excluded.elapsed_time_min,
      elevation_gain_m = excluded.elevation_gain_m,
      average_heartrate = excluded.average_heartrate,
      max_heartrate = excluded.max_heartrate,
      average_cadence = excluded.average_cadence,
      average_speed_kmh = excluded.average_speed_kmh,
      relative_effort = excluded.relative_effort,
      load_score = excluded.load_score,
      gear_id = excluded.gear_id,
      gear_name = excluded.gear_name,
      description = excluded.description,
      synced_at = now()`,
    {
      id: a.id,
      name: a.name ?? null,
      sport_type: a.sport_type ?? null,
      category: a.category ?? null,
      start_date_local: a.start_date_local ?? null,
      distance_km: a.distance_km ?? null,
      moving_time_min: a.moving_time_min ?? null,
      elapsed_time_min: a.elapsed_time_min ?? null,
      elevation_gain_m: a.elevation_gain_m ?? null,
      average_heartrate: a.average_heartrate ?? null,
      max_heartrate: a.max_heartrate ?? null,
      average_cadence: a.average_cadence ?? null,
      average_speed_kmh: a.average_speed_kmh ?? null,
      relative_effort: a.relative_effort ?? null,
      load_score: a.load_score ?? null,
      gear_id: a.gear_id ?? null,
      gear_name: a.gear_name ?? null,
      description: a.description ?? null,
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/db/mutations.test.ts`
Expected: PASS (all tests in the file, not just the new one).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/db/mutations.ts web/src/lib/db/mutations.test.ts
git commit -m "feat: persist activity description in upsertActivity"
```

---

### Task 3: `updateGearName` mutation (fixes `activities.gear_name` never being written)

**Files:**
- Modify: `web/src/lib/db/mutations.ts` (add new function near `upsertGear`, currently around line 432)
- Test: `web/src/lib/db/mutations.test.ts`

**Interfaces:**
- Produces: `updateGearName(conn: DuckDBConnection, gearId: string, gearName: string): Promise<void>` — used by Task 8's `refreshGear` change.

- [ ] **Step 1: Write the failing test**

Add to `web/src/lib/db/mutations.test.ts`:

```ts
import { updateGearName } from "./mutations"; // add to existing import list from "./mutations"

describe("updateGearName", () => {
  it("writes the resolved gear name onto matching activities", async () => {
    await upsertActivity(conn, {
      id: 9101,
      name: "Easy Run",
      start_date_local: "2026-07-20T06:00:00",
      gear_id: "g1",
    });
    await upsertActivity(conn, {
      id: 9102,
      name: "Long Run",
      start_date_local: "2026-07-21T06:00:00",
      gear_id: "g2",
    });

    await updateGearName(conn, "g1", "Nike Pegasus 39");

    const row1 = await queryRow<{ gear_name: string | null }>(
      conn,
      "SELECT gear_name FROM activities WHERE id = $id",
      { id: 9101 },
    );
    const row2 = await queryRow<{ gear_name: string | null }>(
      conn,
      "SELECT gear_name FROM activities WHERE id = $id",
      { id: 9102 },
    );

    expect(row1?.gear_name).toBe("Nike Pegasus 39");
    expect(row2?.gear_name).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/db/mutations.test.ts -t "writes the resolved gear name"`
Expected: FAIL — `updateGearName` is not defined.

- [ ] **Step 3: Implement `updateGearName`**

Add to `web/src/lib/db/mutations.ts`, right after `upsertGear` (around line 443):

```ts
export async function updateGearName(conn: DuckDBConnection, gearId: string, gearName: string): Promise<void> {
  await conn.run("UPDATE activities SET gear_name = $gear_name WHERE gear_id = $gear_id", {
    gear_name: gearName,
    gear_id: gearId,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/db/mutations.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/db/mutations.ts web/src/lib/db/mutations.test.ts
git commit -m "feat: add updateGearName to propagate gear renames onto activities"
```

---

### Task 4: `description` on `RawStravaActivity` and `parseActivity`

**Files:**
- Modify: `web/src/lib/strava/parser.ts`
- Test: `web/src/lib/strava/parser.test.ts` (new)

**Interfaces:**
- Consumes: `ActivityInput.description` (Task 2).
- Produces: `RawStravaActivity.description?: string`; `parseActivity` now sets `description` on its returned `ActivityInput`. Task 7 relies on `parseActivity` mapping `description`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/strava/parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseActivity, type RawStravaActivity } from "./parser";

function baseRaw(overrides: Partial<RawStravaActivity> = {}): RawStravaActivity {
  return {
    id: 1,
    name: "Morning Run",
    sport_type: "Run",
    start_date_local: "2026-07-20T06:00:00Z",
    distance: 10000,
    moving_time: 3000,
    elapsed_time: 3100,
    ...overrides,
  };
}

describe("parseActivity", () => {
  it("maps description when present", () => {
    const result = parseActivity(baseRaw({ description: "Felt great, new shoes" }));
    expect(result.description).toBe("Felt great, new shoes");
  });

  it("maps description to null when absent", () => {
    const result = parseActivity(baseRaw());
    expect(result.description).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/strava/parser.test.ts`
Expected: FAIL — `result.description` is `undefined`, not `"Felt great, new shoes"` / a TS error if `description` isn't a recognized field on `RawStravaActivity`.

- [ ] **Step 3: Add `description` mapping**

In `web/src/lib/strava/parser.ts`, add to `RawStravaActivity` (after `gear_id`):

```ts
  gear_id?: string;
  description?: string;
}
```

And add to the object returned by `parseActivity` (after `gear_id`):

```ts
    gear_id: raw.gear_id ?? null,
    description: raw.description ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/strava/parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/strava/parser.ts web/src/lib/strava/parser.test.ts
git commit -m "feat: parse activity description from Strava"
```

---

### Task 5: `getActivityById` Strava client call

**Files:**
- Modify: `web/src/lib/strava/client.ts`

**Interfaces:**
- Consumes: `RawStravaActivity` (Task 4, for the return type).
- Produces: `getActivityById(accessToken: string, activityId: number): Promise<RawStravaActivity>`, used by Task 8's wiring.

This is a thin fetch wrapper — it mirrors the existing `getGear` (`client.ts:87-95`) and `getActivities` (`client.ts:51-70`), neither of which has a unit test in this codebase (no mocked-`fetch` convention exists here). Follow that precedent: no test for this function directly. Its behavior is exercised through Task 7's `refreshRecentActivities`, which takes an injected fetch function specifically so *that* logic can be unit-tested without a network mock.

- [ ] **Step 1: Add `getActivityById`**

In `web/src/lib/strava/client.ts`, add after `getActivityStreams` (around line 77):

```ts
export async function getActivityById(accessToken: string, activityId: number): Promise<RawStravaActivity> {
  return stravaFetch(`/activities/${activityId}`, accessToken) as Promise<RawStravaActivity>;
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/strava/client.ts
git commit -m "feat: add getActivityById Strava client call"
```

---

### Task 6: `hasEditableChanges` and `getRecentRefreshCount` pure helpers

**Files:**
- Modify: `web/src/lib/strava/sync.ts`
- Test: `web/src/lib/strava/sync.test.ts` (new)

**Interfaces:**
- Produces:
  - `export interface EditableActivityFields { name?: string | null; description?: string | null; gear_id?: string | null }`
  - `export function hasEditableChanges(stored: EditableActivityFields, fetched: EditableActivityFields): boolean`
  - `export function getRecentRefreshCount(): number`
  - Task 7 consumes both.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/strava/sync.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { getRecentRefreshCount, hasEditableChanges } from "./sync";

describe("hasEditableChanges", () => {
  it("returns false when name, description, and gear_id are all unchanged", () => {
    const stored = { name: "Morning Run", description: "Felt good", gear_id: "g1" };
    const fetched = { name: "Morning Run", description: "Felt good", gear_id: "g1" };
    expect(hasEditableChanges(stored, fetched)).toBe(false);
  });

  it("returns true when gear_id changed (shoe reassigned)", () => {
    const stored = { name: "Morning Run", description: "Felt good", gear_id: "g1" };
    const fetched = { name: "Morning Run", description: "Felt good", gear_id: "g2" };
    expect(hasEditableChanges(stored, fetched)).toBe(true);
  });

  it("returns true when description changed", () => {
    const stored = { name: "Morning Run", description: null, gear_id: "g1" };
    const fetched = { name: "Morning Run", description: "Added notes later", gear_id: "g1" };
    expect(hasEditableChanges(stored, fetched)).toBe(true);
  });

  it("treats null and undefined as equivalent", () => {
    const stored = { name: "Morning Run", description: null, gear_id: "g1" };
    const fetched = { name: "Morning Run", description: undefined, gear_id: "g1" };
    expect(hasEditableChanges(stored, fetched)).toBe(false);
  });
});

describe("getRecentRefreshCount", () => {
  const ORIGINAL = process.env.STRAVA_RECENT_REFRESH_COUNT;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.STRAVA_RECENT_REFRESH_COUNT;
    else process.env.STRAVA_RECENT_REFRESH_COUNT = ORIGINAL;
  });

  it("defaults to 5 when unset", () => {
    delete process.env.STRAVA_RECENT_REFRESH_COUNT;
    expect(getRecentRefreshCount()).toBe(5);
  });

  it("uses the env var when set to a valid positive integer", () => {
    process.env.STRAVA_RECENT_REFRESH_COUNT = "12";
    expect(getRecentRefreshCount()).toBe(12);
  });

  it("falls back to 5 for an invalid value", () => {
    process.env.STRAVA_RECENT_REFRESH_COUNT = "not-a-number";
    expect(getRecentRefreshCount()).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/strava/sync.test.ts`
Expected: FAIL — `hasEditableChanges` and `getRecentRefreshCount` are not exported from `./sync`.

- [ ] **Step 3: Implement the helpers**

In `web/src/lib/strava/sync.ts`, add near the top (after the imports, before `runSync`):

```ts
export interface EditableActivityFields {
  name?: string | null;
  description?: string | null;
  gear_id?: string | null;
}

export function hasEditableChanges(stored: EditableActivityFields, fetched: EditableActivityFields): boolean {
  return (
    (stored.name ?? null) !== (fetched.name ?? null) ||
    (stored.description ?? null) !== (fetched.description ?? null) ||
    (stored.gear_id ?? null) !== (fetched.gear_id ?? null)
  );
}

export function getRecentRefreshCount(): number {
  const raw = process.env.STRAVA_RECENT_REFRESH_COUNT;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/strava/sync.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/strava/sync.ts web/src/lib/strava/sync.test.ts
git commit -m "feat: add hasEditableChanges and getRecentRefreshCount helpers"
```

---

### Task 7: `refreshRecentActivities`

**Files:**
- Modify: `web/src/lib/strava/sync.ts`
- Test: `web/src/lib/strava/sync.test.ts`

**Interfaces:**
- Consumes: `hasEditableChanges`, `EditableActivityFields` (Task 6); `RawStravaActivity`, `parseActivity` (Task 4); `upsertActivity`, `ActivityInput` (Task 2); `queryRows` from `web/src/lib/db/client.ts`.
- Produces: `export async function refreshRecentActivities(conn: DuckDBConnection, fetchDetail: (id: number) => Promise<RawStravaActivity>, count: number): Promise<ActivityInput[]>` — resolves to the list of activities it actually changed (empty if none). Task 8 consumes this return value to fold newly-seen gear ids into `refreshGear`, and calls this function from `runSync` with a real `getActivityById`-backed `fetchDetail`.

`fetchDetail` is injected (rather than this function taking `accessToken` and calling `getActivityById` itself) specifically so the test below can supply canned responses instead of hitting the network — matching how the rest of this task's logic is unit-tested while `getActivityById` itself (Task 5) is not.

- [ ] **Step 1: Write the failing test**

Add to `web/src/lib/strava/sync.test.ts`. Change the existing `vitest` import line to add `beforeEach`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
```

Then add these new imports, and the test block below (needs `DuckDBConnection` type, `createTestConnection`, `upsertActivity`, `queryRow`, and `refreshRecentActivities`):

```ts
import type { DuckDBConnection } from "@duckdb/node-api";
import { createTestConnection } from "../db/testHelper";
import { queryRow } from "../db/client";
import { upsertActivity } from "../db/mutations";
import { refreshRecentActivities } from "./sync";
import type { RawStravaActivity } from "./parser";

describe("refreshRecentActivities", () => {
  let conn: DuckDBConnection;

  beforeEach(async () => {
    conn = await createTestConnection();
  });

  it("upserts only activities whose editable fields changed, and returns those changes", async () => {
    await upsertActivity(conn, {
      id: 9201,
      name: "Morning Run",
      start_date_local: "2026-07-20T06:00:00",
      gear_id: "g1",
      description: null,
    });
    await upsertActivity(conn, {
      id: 9202,
      name: "Evening Run",
      start_date_local: "2026-07-21T06:00:00",
      gear_id: "g1",
      description: null,
    });

    const rawById: Record<number, RawStravaActivity> = {
      9201: { id: 9201, name: "Morning Run", start_date_local: "2026-07-20T06:00:00Z", gear_id: "g1" },
      9202: {
        id: 9202,
        name: "Evening Run",
        start_date_local: "2026-07-21T06:00:00Z",
        gear_id: "g2",
        description: "Swapped to trail shoes",
      },
    };

    const changed = await refreshRecentActivities(conn, async (id) => rawById[id], 5);

    expect(changed.map((a) => a.id)).toEqual([9202]);

    const row9202 = await queryRow<{ gear_id: string | null; description: string | null }>(
      conn,
      "SELECT gear_id, description FROM activities WHERE id = $id",
      { id: 9202 },
    );
    expect(row9202?.gear_id).toBe("g2");
    expect(row9202?.description).toBe("Swapped to trail shoes");

    const row9201 = await queryRow<{ gear_id: string | null; description: string | null }>(
      conn,
      "SELECT gear_id, description FROM activities WHERE id = $id",
      { id: 9201 },
    );
    expect(row9201?.gear_id).toBe("g1");
    expect(row9201?.description).toBeNull();
  });

  it("respects the count limit, refreshing only the most recent N", async () => {
    await upsertActivity(conn, { id: 9301, name: "Old", start_date_local: "2026-07-01T06:00:00" });
    await upsertActivity(conn, { id: 9302, name: "New", start_date_local: "2026-07-20T06:00:00" });

    const rawById: Record<number, RawStravaActivity> = {
      9301: { id: 9301, name: "Old - edited", start_date_local: "2026-07-01T06:00:00Z" },
      9302: { id: 9302, name: "New - edited", start_date_local: "2026-07-20T06:00:00Z" },
    };

    const changed = await refreshRecentActivities(conn, async (id) => rawById[id], 1);

    expect(changed.map((a) => a.id)).toEqual([9302]);
  });

  it("continues past a fetchDetail failure for one activity", async () => {
    await upsertActivity(conn, { id: 9401, name: "A", start_date_local: "2026-07-19T06:00:00" });
    await upsertActivity(conn, { id: 9402, name: "B", start_date_local: "2026-07-20T06:00:00" });

    const changed = await refreshRecentActivities(
      conn,
      async (id) => {
        if (id === 9402) throw new Error("Strava API 500");
        return { id, name: "A - edited", start_date_local: "2026-07-19T06:00:00Z" };
      },
      5,
    );

    expect(changed.map((a) => a.id)).toEqual([9401]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/strava/sync.test.ts`
Expected: FAIL — `refreshRecentActivities` is not exported from `./sync`.

- [ ] **Step 3: Implement `refreshRecentActivities`**

In `web/src/lib/strava/sync.ts`, add the function after the new helpers from Task 6, before `runSync`. It only needs `queryRows` and `upsertActivity`, both already imported in this file:

```ts
export async function refreshRecentActivities(
  conn: DuckDBConnection,
  fetchDetail: (id: number) => Promise<RawStravaActivity>,
  count: number,
): Promise<ActivityInput[]> {
  const recent = await queryRows<{ id: number; name: string | null; description: string | null; gear_id: string | null }>(
    conn,
    "SELECT id, name, description, gear_id FROM activities ORDER BY start_date_local DESC LIMIT $count",
    { count },
  );

  const changed: ActivityInput[] = [];
  for (const stored of recent) {
    try {
      const raw = await fetchDetail(stored.id);
      const fetched = parseActivity(raw);
      if (hasEditableChanges(stored, fetched)) {
        await upsertActivity(conn, fetched);
        changed.push(fetched);
      }
    } catch (err) {
      console.error(`Failed to refresh recent activity ${stored.id}:`, err);
    }
  }

  return changed;
}
```

Add `RawStravaActivity` to the existing `import { parseActivity } from "./parser"` line (it needs both):

```ts
import { parseActivity, type RawStravaActivity } from "./parser";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/strava/sync.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/strava/sync.ts web/src/lib/strava/sync.test.ts
git commit -m "feat: add refreshRecentActivities to pick up post-hoc Strava edits"
```

---

### Task 8: Wire into `runSync`; fix `refreshGear` gear_name propagation

**Files:**
- Modify: `web/src/lib/strava/sync.ts:1-68`

**Interfaces:**
- Consumes: `getActivityById` (Task 5), `refreshRecentActivities`, `getRecentRefreshCount` (Tasks 6-7), `updateGearName` (Task 3).
- Produces: the complete feature — no further tasks depend on this one.

This task wires together already-tested pieces (Tasks 1-7) into `runSync`'s network-touching orchestration, which — consistent with this codebase's existing convention — is not itself unit-tested (`runSync` and the pre-existing `refreshGear` have no test today either). Correctness here is verified by re-running the full test suite plus a type-check.

- [ ] **Step 1: Update imports**

In `web/src/lib/strava/sync.ts`, update the `./client` import to include `getActivityById`:

```ts
import { getActivities, getActivityById, getGear, refreshAccessToken } from "./client";
```

And add `updateGearName` to the `../db/mutations` import list:

```ts
import {
  correlateActivitiesToPlan,
  getLastSynced,
  setLastSynced,
  updateGearName,
  upsertActivity,
  upsertGear,
  type ActivityInput,
} from "../db/mutations";
```

- [ ] **Step 2: Call `refreshRecentActivities` from `runSync`, and fold its changes into `refreshGear`'s input**

Replace the existing gear-refresh call in `runSync` (currently just `await refreshGear(conn, accessToken, newActivities);`) with:

```ts
  const refreshedActivities = await refreshRecentActivities(
    conn,
    (id) => getActivityById(accessToken, id),
    getRecentRefreshCount(),
  );

  // Refresh every known shoe/gear's name + retired status from Strava on
  // every sync, not just gear seen on brand-new activities — a shoe you just
  // retired in Strava won't appear on any new activity again, so that's
  // exactly the case that needs an unconditional refresh to be caught.
  await refreshGear(conn, accessToken, [...newActivities, ...refreshedActivities]);
```

(This replaces the old comment+call block at `sync.ts:40-44` — the comment carries over unchanged, just above the new call.)

- [ ] **Step 3: Fix `refreshGear` to propagate `gear_name` onto `activities`**

In `refreshGear` (`sync.ts:55-68`), add a call to `updateGearName` right after each gear's `upsertGear` call:

```ts
async function refreshGear(conn: DuckDBConnection, accessToken: string, newActivities: ActivityInput[]): Promise<void> {
  const knownGearRows = await queryRows<{ id: string }>(conn, "SELECT id FROM gear");
  const gearIds = new Set(knownGearRows.map((r) => r.id));
  for (const activity of newActivities) {
    if (activity.gear_id) gearIds.add(activity.gear_id);
  }

  for (const gearId of gearIds) {
    const gearData = await getGear(accessToken, gearId);
    if (gearData) {
      const name = gearData.name ?? gearId;
      await upsertGear(conn, gearId, name, gearData.retired ?? false);
      await updateGearName(conn, gearId, name);
    }
  }
}
```

- [ ] **Step 4: Type-check and run the full test suite**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass, including every test added in Tasks 1-7.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/strava/sync.ts
git commit -m "feat: wire recent-activity refresh into runSync and fix gear_name propagation"
```

---

## Manual Verification

After all tasks are committed, confirm the feature end-to-end against the real Strava account:

1. Deploy or run locally with real credentials (`web/.env` — see `[[reference_motherduck_credentials]]` memory for where the live token lives).
2. On Strava, edit the title, description, or gear of one of your 5 most recent activities.
3. Tap the manual sync button in the dashboard.
4. Confirm the dashboard reflects the edited title/gear (description isn't surfaced in any UI yet — check via a direct DuckDB query: `SELECT name, description, gear_name FROM activities WHERE id = <activity_id>`).
