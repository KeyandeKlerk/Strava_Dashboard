// Split out from gymMutations.ts (already 400+ lines) rather than added to
// it — a new, unrelated table gets its own small module instead of growing
// an already-large file. Same conventions throughout: interfaces + functions
// over queryRow/queryRows/conn.run, idempotent on a client-generated
// client_uuid like every other gym table.
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRow, queryRows } from "./client";

export interface BodyWeightLogRow {
  id: number;
  client_uuid: string | null;
  logged_date: string;
  weight_kg: number;
}

export interface LogBodyWeightInput {
  client_uuid: string;
  logged_date: string;
  weight_kg: number;
}

// One-shot record creation (like addGymSet/addCustomExercise), not an
// evolving-fields upsert (like upsertGymSession) — a body weight entry has
// nothing that gets filled in later, so a retried submit with the same
// client_uuid is a plain no-op rather than needing COALESCE merge semantics.
export async function logBodyWeight(
  conn: DuckDBConnection,
  input: LogBodyWeightInput,
): Promise<{ id: number; client_uuid: string }> {
  await conn.run(
    `INSERT INTO body_weight_logs (client_uuid, logged_date, weight_kg)
     VALUES ($client_uuid, $logged_date, $weight_kg)
     ON CONFLICT (client_uuid) DO NOTHING`,
    {
      client_uuid: input.client_uuid,
      logged_date: input.logged_date,
      weight_kg: input.weight_kg,
    },
  );

  const row = await queryRow<{ id: number; client_uuid: string }>(
    conn,
    "SELECT id, client_uuid FROM body_weight_logs WHERE client_uuid = $client_uuid",
    { client_uuid: input.client_uuid },
  );
  return row!;
}

export async function listBodyWeightLogs(conn: DuckDBConnection, n = 90): Promise<BodyWeightLogRow[]> {
  return queryRows<BodyWeightLogRow>(
    conn,
    `SELECT id, client_uuid, logged_date::VARCHAR AS logged_date, weight_kg
     FROM body_weight_logs
     ORDER BY logged_date DESC, id DESC
     LIMIT $n`,
    { n },
  );
}

// Deleting an already-deleted or never-landed row is a no-op — naturally
// idempotent, no special-casing needed (matches deleteGymSet/deleteGymSession).
export async function deleteBodyWeightLog(conn: DuckDBConnection, clientUuid: string): Promise<void> {
  await conn.run("DELETE FROM body_weight_logs WHERE client_uuid = $client_uuid", { client_uuid: clientUuid });
}
