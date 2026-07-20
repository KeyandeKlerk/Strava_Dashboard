"use server";
import { after } from "next/server";
import { revalidateTag } from "next/cache";
import { getConnection } from "./db/client";
import { runSync } from "./strava/sync";
import { DASHBOARD_DATA_TAG } from "./pageData";

// Mirrors web/src/app/api/webhook/strava/route.ts's fire-and-forget pattern:
// runSync's trailing backfill sleeps 5s per activity needing streams, which
// can run well past a request's usable duration, so the response returns
// immediately and the sync runs in `after()`. There's no way to report
// "sync finished" back to the button that triggered it — only "started".
export async function triggerSyncAction(): Promise<void> {
  const conn = await getConnection();
  after(async () => {
    try {
      await runSync(conn);
      revalidateTag(DASHBOARD_DATA_TAG, { expire: 0 });
    } catch (err) {
      console.error("Manual sync failed:", err);
    }
  });
}
