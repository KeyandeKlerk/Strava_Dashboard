// REST (not a server action) — see web/src/app/api/gym/sessions/route.ts's
// header comment for why. Returns 409 (not 500) when the parent session
// hasn't synced yet, so the offline queue treats it as retry-later rather
// than a dead mutation — this only resolves once the queue flushes the
// session-create mutation first (strict FIFO order).
import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/db/client";
import { addGymSet } from "@/lib/db/gymMutations";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { client_uuid, session_client_uuid, exercise_id, set_number, weight_kg, reps } = body ?? {};

  if (typeof client_uuid !== "string" || !client_uuid) {
    return NextResponse.json({ error: "client_uuid is required" }, { status: 400 });
  }
  if (typeof session_client_uuid !== "string" || !session_client_uuid) {
    return NextResponse.json({ error: "session_client_uuid is required" }, { status: 400 });
  }
  if (typeof exercise_id !== "number" || typeof set_number !== "number" || typeof weight_kg !== "number" || typeof reps !== "number") {
    return NextResponse.json({ error: "exercise_id, set_number, weight_kg, and reps must be numbers" }, { status: 400 });
  }

  const conn = await getConnection();
  const result = await addGymSet(conn, {
    client_uuid,
    session_client_uuid,
    exercise_id,
    set_number,
    weight_kg,
    reps,
  });

  if ("error" in result) {
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json(result);
}
