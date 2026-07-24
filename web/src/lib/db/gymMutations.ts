// Gym tracker: no Python precedent (unlike mutations.ts, ported from
// src/db.py), kept as its own module. Every write here that can originate
// offline is idempotent on a client-generated client_uuid, so a retried
// request that actually landed the first time resolves back to the same row
// instead of erroring or double-inserting.
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRow, queryRows } from "./client";

export interface GymExerciseRow {
  id: number;
  client_uuid: string | null;
  name: string;
  muscle_group: string;
  equipment: string | null;
  is_custom: boolean;
}

export async function listGymExercises(conn: DuckDBConnection): Promise<GymExerciseRow[]> {
  return queryRows<GymExerciseRow>(
    conn,
    `SELECT id, client_uuid, name, muscle_group, equipment, is_custom
     FROM gym_exercises
     ORDER BY muscle_group, name`,
  );
}

export interface AddCustomExerciseInput {
  client_uuid: string;
  name: string;
  muscle_group: string;
  equipment?: string | null;
}

// Re-adding an existing name (case-insensitive) is treated as a no-op reuse
// rather than an error, since a custom exercise offline-queued twice (or one
// that happens to match a seeded name) shouldn't create a duplicate.
export async function addCustomExercise(
  conn: DuckDBConnection,
  input: AddCustomExerciseInput,
): Promise<{ id: number; client_uuid: string | null }> {
  const existing = await queryRow<{ id: number; client_uuid: string | null }>(
    conn,
    "SELECT id, client_uuid FROM gym_exercises WHERE lower(name) = lower($name)",
    { name: input.name },
  );
  if (existing) return existing;

  await conn.run(
    `INSERT INTO gym_exercises (client_uuid, name, muscle_group, equipment, is_custom)
     VALUES ($client_uuid, $name, $muscle_group, $equipment, TRUE)
     ON CONFLICT (client_uuid) DO NOTHING`,
    {
      client_uuid: input.client_uuid,
      name: input.name,
      muscle_group: input.muscle_group,
      equipment: input.equipment ?? null,
    },
  );

  const row = await queryRow<{ id: number; client_uuid: string | null }>(
    conn,
    "SELECT id, client_uuid FROM gym_exercises WHERE client_uuid = $client_uuid",
    { client_uuid: input.client_uuid },
  );
  return row!;
}

export interface UpsertGymSessionInput {
  client_uuid: string;
  session_date: string;
  started_at?: string | null;
  ended_at?: string | null;
  activity_id?: number | null;
  notes?: string | null;
}

// Both "start session" and "end session" replay through this one call keyed
// by client_uuid. COALESCE on conflict means a field only ever moves from
// unset to set (or is explicitly refreshed) — a retried "start" landing
// after "end" has already synced can't null out ended_at/activity_id.
export async function upsertGymSession(
  conn: DuckDBConnection,
  input: UpsertGymSessionInput,
): Promise<{ id: number; client_uuid: string }> {
  await conn.run(
    `INSERT INTO gym_sessions (client_uuid, session_date, started_at, ended_at, activity_id, notes)
     VALUES ($client_uuid, $session_date, $started_at, $ended_at, $activity_id, $notes)
     ON CONFLICT (client_uuid) DO UPDATE SET
       started_at = COALESCE(excluded.started_at, gym_sessions.started_at),
       ended_at = COALESCE(excluded.ended_at, gym_sessions.ended_at),
       notes = COALESCE(excluded.notes, gym_sessions.notes),
       activity_id = COALESCE(excluded.activity_id, gym_sessions.activity_id)`,
    {
      client_uuid: input.client_uuid,
      session_date: input.session_date,
      started_at: input.started_at ?? null,
      ended_at: input.ended_at ?? null,
      activity_id: input.activity_id ?? null,
      notes: input.notes ?? null,
    },
  );

  const row = await queryRow<{ id: number; client_uuid: string }>(
    conn,
    "SELECT id, client_uuid FROM gym_sessions WHERE client_uuid = $client_uuid",
    { client_uuid: input.client_uuid },
  );
  return row!;
}

export interface AddGymSetInput {
  client_uuid: string;
  session_client_uuid: string;
  exercise_id: number;
  set_number: number;
  weight_kg: number;
  reps: number;
  is_warmup?: boolean;
  rpe?: number | null;
}

export interface AddGymSetError {
  error: string;
}

// session_id is resolved server-side by session_client_uuid rather than
// requiring the client to know the session's server-assigned integer id —
// a set logged immediately after starting a brand-new offline session can't
// know that id yet. This only produces correct results if the offline queue
// flushes strictly in FIFO order (session-create before its sets).
export async function addGymSet(
  conn: DuckDBConnection,
  input: AddGymSetInput,
): Promise<{ id: number; client_uuid: string } | AddGymSetError> {
  await conn.run(
    `INSERT INTO gym_sets (client_uuid, session_id, exercise_id, set_number, weight_kg, reps, is_warmup, rpe)
     SELECT $client_uuid, s.id, $exercise_id, $set_number, $weight_kg, $reps, $is_warmup, $rpe
     FROM gym_sessions s WHERE s.client_uuid = $session_client_uuid
     ON CONFLICT (client_uuid) DO NOTHING`,
    {
      client_uuid: input.client_uuid,
      session_client_uuid: input.session_client_uuid,
      exercise_id: input.exercise_id,
      set_number: input.set_number,
      weight_kg: input.weight_kg,
      reps: input.reps,
      is_warmup: input.is_warmup ?? false,
      rpe: input.rpe ?? null,
    },
  );

  const row = await queryRow<{ id: number; client_uuid: string }>(
    conn,
    "SELECT id, client_uuid FROM gym_sets WHERE client_uuid = $client_uuid",
    { client_uuid: input.client_uuid },
  );
  if (!row) return { error: "Session not synced yet." };
  return row;
}

// Deleting an already-deleted or never-landed row is a no-op — naturally
// idempotent, no special-casing needed.
export async function deleteGymSet(conn: DuckDBConnection, clientUuid: string): Promise<void> {
  await conn.run("DELETE FROM gym_sets WHERE client_uuid = $client_uuid", { client_uuid: clientUuid });
}

// Deleting an already-deleted or never-landed row is a no-op — naturally
// idempotent, no special-casing needed. No FK/cascade exists at the DB level
// (session_id/exercise_id are plain, unconstrained integers), so the sets
// delete must happen first, as its own statement, before the session row
// disappears.
export async function deleteGymSession(conn: DuckDBConnection, clientUuid: string): Promise<void> {
  await conn.run(
    `DELETE FROM gym_sets WHERE session_id = (SELECT id FROM gym_sessions WHERE client_uuid = $client_uuid)`,
    { client_uuid: clientUuid },
  );
  await conn.run(`DELETE FROM gym_sessions WHERE client_uuid = $client_uuid`, { client_uuid: clientUuid });
}

export async function updateGymSessionNotes(
  conn: DuckDBConnection,
  clientUuid: string,
  notes: string | null,
): Promise<void> {
  await conn.run("UPDATE gym_sessions SET notes = $notes WHERE client_uuid = $client_uuid", {
    notes,
    client_uuid: clientUuid,
  });
}

export interface GymSetDetailRow {
  id: number;
  client_uuid: string;
  exercise_id: number;
  exercise_name: string;
  muscle_group: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  is_warmup: boolean;
  rpe: number | null;
  logged_at: string;
}

export interface GymSessionDetail {
  id: number;
  client_uuid: string;
  session_date: string;
  started_at: string | null;
  ended_at: string | null;
  activity_id: number | null;
  notes: string | null;
  sets: GymSetDetailRow[];
}

async function loadGymSessionDetail(
  conn: DuckDBConnection,
  whereClause: string,
  params: Record<string, unknown>,
): Promise<GymSessionDetail | null> {
  const session = await queryRow<Omit<GymSessionDetail, "sets">>(
    conn,
    `SELECT id, client_uuid, session_date::VARCHAR AS session_date,
            started_at::VARCHAR AS started_at, ended_at::VARCHAR AS ended_at,
            activity_id, notes
     FROM gym_sessions WHERE ${whereClause}`,
    params,
  );
  if (!session) return null;

  const sets = await queryRows<GymSetDetailRow>(
    conn,
    `SELECT gs.id, gs.client_uuid, gs.exercise_id, ge.name AS exercise_name, ge.muscle_group,
            gs.set_number, gs.weight_kg, gs.reps, gs.is_warmup, gs.rpe, gs.logged_at::VARCHAR AS logged_at
     FROM gym_sets gs
     JOIN gym_exercises ge ON ge.id = gs.exercise_id
     WHERE gs.session_id = $id
     ORDER BY gs.set_number`,
    { id: session.id },
  );

  return { ...session, sets };
}

export async function getGymSessionDetail(conn: DuckDBConnection, sessionId: number): Promise<GymSessionDetail | null> {
  return loadGymSessionDetail(conn, "id = $id", { id: sessionId });
}

export async function getGymSessionByActivityId(conn: DuckDBConnection, activityId: number): Promise<GymSessionDetail | null> {
  return loadGymSessionDetail(conn, "activity_id = $activity_id", { activity_id: activityId });
}

export interface GymSessionListRow {
  id: number;
  client_uuid: string;
  session_date: string;
  activity_id: number | null;
  set_count: number;
  total_volume_kg: number;
}

export async function listRecentGymSessions(conn: DuckDBConnection, n = 15): Promise<GymSessionListRow[]> {
  return queryRows<GymSessionListRow>(
    conn,
    `SELECT gs.id, gs.client_uuid, gs.session_date::VARCHAR AS session_date, gs.activity_id,
            COUNT(st.id)::INTEGER AS set_count,
            COALESCE(SUM(st.weight_kg * st.reps), 0) AS total_volume_kg
     FROM gym_sessions gs
     LEFT JOIN gym_sets st ON st.session_id = gs.id
     GROUP BY gs.id, gs.client_uuid, gs.session_date, gs.activity_id
     ORDER BY gs.session_date DESC, gs.id DESC
     LIMIT $n`,
    { n },
  );
}

// Matches correlateActivitiesToPlan's date-based-matching style: link any
// standalone gym session to the first not-yet-claimed same-day 'gym'
// activity. Safe to call repeatedly/as a no-op — only touches sessions with
// activity_id still NULL.
export async function correlateGymSessionsToActivities(conn: DuckDBConnection): Promise<number> {
  await conn.run(`
    UPDATE gym_sessions s
    SET activity_id = a.id
    FROM (
        SELECT start_date_local::DATE AS gym_date, MIN(id) AS id
        FROM activities
        WHERE category = 'gym'
          AND id NOT IN (SELECT activity_id FROM gym_sessions WHERE activity_id IS NOT NULL)
        GROUP BY 1
    ) a
    WHERE s.activity_id IS NULL
      AND s.session_date = a.gym_date
  `);

  const row = await queryRow<{ count: number | bigint }>(
    conn,
    "SELECT COUNT(*) AS count FROM gym_sessions WHERE activity_id IS NOT NULL",
  );
  return Number(row?.count ?? 0);
}

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
