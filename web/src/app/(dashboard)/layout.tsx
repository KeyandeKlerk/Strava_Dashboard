import { Suspense, ViewTransition } from "react";
import { connection } from "next/server";
import { BottomNav } from "@/components/BottomNav";
import { SyncButton } from "@/components/SyncButton";
import { getCachedLastSynced } from "@/lib/pageData";

function formatLastSynced(epochSeconds: number): string {
  const diffMin = Math.round((Date.now() - epochSeconds * 1000) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

// The epoch timestamp is cached (getCachedLastSynced), but the relative-time
// string is computed from Date.now() at request time — connection() marks
// this subtree as genuinely per-request so the string never gets frozen
// into the prerendered static shell (see Task 5 in the implementation plan
// for why: without it, "5m ago" would stay fixed until the next sync
// invalidates the cache, which can be hours later).
async function LastSyncedLabel() {
  await connection();
  const lastSynced = await getCachedLastSynced();
  return <span>{lastSynced != null ? `Last synced ${formatLastSynced(lastSynced)}` : "Not synced yet"}</span>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <div
        style={{ viewTransitionName: "site-header" }}
        className="mx-auto flex w-full max-w-3xl items-center justify-end gap-2 px-4 pt-2 text-right text-xs text-neutral-400"
      >
        <Suspense fallback={<span>Checking sync status…</span>}>
          <LastSyncedLabel />
        </Suspense>
        <span aria-hidden="true">·</span>
        <SyncButton />
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-2">
        <ViewTransition name="tab-content" share="tab-crossfade" enter="suspense-reveal" default="none">
          {children}
        </ViewTransition>
      </main>
      <BottomNav />
    </div>
  );
}
