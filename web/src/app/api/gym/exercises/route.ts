// REST (not a server action) — see web/src/app/api/gym/sessions/route.ts's
// header comment for why.
import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/db/client";
import { addCustomExercise } from "@/lib/db/gymMutations";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { client_uuid, name, muscle_group, equipment } = body ?? {};

  if (typeof client_uuid !== "string" || !client_uuid) {
    return NextResponse.json({ error: "client_uuid is required" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof muscle_group !== "string" || !muscle_group) {
    return NextResponse.json({ error: "muscle_group is required" }, { status: 400 });
  }

  const conn = await getConnection();
  const result = await addCustomExercise(conn, {
    client_uuid,
    name: name.trim(),
    muscle_group,
    equipment: equipment ?? null,
  });

  return NextResponse.json(result);
}
