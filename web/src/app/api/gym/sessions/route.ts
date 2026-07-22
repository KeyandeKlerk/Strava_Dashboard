// REST (not a server action) so the offline sync manager can replay a queued
// mutation as a stable fetch() across app reloads/redeploys — see
// web/src/lib/gymOffline/. Idempotent on client_uuid.
import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/db/client";
import { upsertGymSession } from "@/lib/db/gymMutations";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { client_uuid, session_date, started_at, ended_at, activity_id, notes } = body ?? {};

  if (typeof client_uuid !== "string" || !client_uuid) {
    return NextResponse.json({ error: "client_uuid is required" }, { status: 400 });
  }
  if (typeof session_date !== "string" || !session_date) {
    return NextResponse.json({ error: "session_date is required" }, { status: 400 });
  }

  const conn = await getConnection();
  const result = await upsertGymSession(conn, {
    client_uuid,
    session_date,
    started_at: started_at ?? null,
    ended_at: ended_at ?? null,
    activity_id: activity_id ?? null,
    notes: notes ?? null,
  });

  return NextResponse.json(result);
}
