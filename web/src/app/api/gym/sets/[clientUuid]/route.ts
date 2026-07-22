import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db/client";
import { deleteGymSet } from "@/lib/db/gymMutations";

export const runtime = "nodejs";

// Deleting an already-deleted or never-landed client_uuid is a no-op, so this
// is naturally idempotent for offline-queue replay.
export async function DELETE(_request: Request, { params }: { params: Promise<{ clientUuid: string }> }) {
  const { clientUuid } = await params;
  const conn = await getConnection();
  await deleteGymSet(conn, clientUuid);
  return NextResponse.json({ ok: true });
}
