// Lets the client (PwaPrecache) cheaply check whether a sync has happened
// since it last precached the dashboard pages for offline use, without
// pulling in any of the heavier cached page data.
import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db/client";
import { getLastSynced } from "@/lib/db/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const lastSyncedAt = (await getLastSynced(await getConnection())) ?? null;
  return NextResponse.json({ lastSyncedAt });
}
