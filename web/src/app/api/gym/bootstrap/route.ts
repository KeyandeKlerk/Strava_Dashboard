// Used by the offline sync manager (web/src/lib/gymOffline/) to hydrate/
// refresh the client-side IndexedDB cache whenever the app has connectivity,
// independent of a full page reload.
import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db/client";
import { listGymExercises, listRecentGymSessions } from "@/lib/db/gymMutations";

export const runtime = "nodejs";

export async function GET() {
  const conn = await getConnection();
  const [exercises, recentSessions] = await Promise.all([listGymExercises(conn), listRecentGymSessions(conn)]);
  return NextResponse.json({ exercises, recentSessions });
}
