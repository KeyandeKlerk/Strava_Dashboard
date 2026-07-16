// Ported from webhook/app.py. Touches MotherDuck via native bindings, so this
// must run on the Node.js runtime (not Edge).
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { revalidateTag } from "next/cache";
import { getConnection } from "@/lib/db/client";
import { runSync } from "@/lib/strava/sync";
import { DASHBOARD_DATA_TAG } from "@/lib/pageData";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const verifyToken = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (verifyToken !== process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ error: "Invalid verify token" }, { status: 403 });
  }
  return NextResponse.json({ "hub.challenge": challenge });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (body?.object_type === "activity" && body?.aspect_type === "create") {
    // Strava expects a fast ack; run the actual sync after the response is
    // sent via `after()` so the function isn't frozen/killed before it finishes
    // (a bare non-awaited call would race the response on Vercel's runtime).
    after(async () => {
      const conn = await getConnection();
      try {
        await runSync(conn);
        // Only invalidate the dashboard's cached data once sync actually
        // succeeds — a failed sync shouldn't force every page to re-query
        // MotherDuck for data that hasn't changed. `{ expire: 0 }` forces
        // immediate expiration (next request blocks on fresh data) rather
        // than the default `'max'` stale-while-revalidate profile, which
        // would serve one more stale page load before refreshing.
        revalidateTag(DASHBOARD_DATA_TAG, { expire: 0 });
      } catch (err) {
        console.error("Sync failed:", err);
      }
    });
  }

  return NextResponse.json({ status: "ok" });
}
