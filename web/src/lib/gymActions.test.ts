// gymActions.ts's mutating functions call Next.js's updateTag(), which
// throws outside an actual Server Action request context (verified: calling
// it directly in a plain Node/vitest run throws "updateTag can only be
// called from within a Server Action"). Mocking next/cache is unavoidable
// here — it's the true framework boundary, not internal logic — and
// getConnection is swapped for a real in-memory test connection, consistent
// with every other DB-backed test in this codebase.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { createTestConnection } from "./db/testHelper";

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  updateTag: vi.fn(),
}));

let testConn: DuckDBConnection;
vi.mock("./db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db/client")>();
  return {
    ...actual,
    getConnection: vi.fn(() => testConn),
  };
});

import { updateTag } from "next/cache";
import { addCustomExerciseAction } from "./gymActions";
import { GYM_DATA_TAG } from "./pageData";

beforeEach(async () => {
  testConn = await createTestConnection();
  vi.clearAllMocks();
});

describe("addCustomExerciseAction", () => {
  it("invalidates the gym data cache tag after creating a custom exercise", async () => {
    const formData = new FormData();
    formData.set("name", "Cable Pullover");
    formData.set("muscle_group", "Lats");

    const result = await addCustomExerciseAction(formData);

    expect(result.exercise?.name).toBe("Cable Pullover");
    expect(vi.mocked(updateTag)).toHaveBeenCalledWith(GYM_DATA_TAG);
  });
});
