import { BottomNav } from "@/components/BottomNav";
import { SyncButton } from "@/components/SyncButton";
import { getConnection } from "@/lib/db/client";
import { getLastSynced } from "@/lib/db/mutations";

// Without this, Next statically prerenders these pages at build time (no
// cookies/headers/searchParams access triggers the auto-static heuristic),
// freezing the dashboard's DB-backed data until the next deploy.
export const dynamic = "force-dynamic";

function formatLastSynced(epochSeconds: number): string {
  const diffMin = Math.round((Date.now() - epochSeconds * 1000) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const lastSynced = await getLastSynced(await getConnection());

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-2 px-4 pt-2 text-right text-xs text-neutral-400">
        <span>{lastSynced != null ? `Last synced ${formatLastSynced(lastSynced)}` : "Not synced yet"}</span>
        <span aria-hidden="true">·</span>
        <SyncButton />
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-2">{children}</main>
      <BottomNav />
    </div>
  );
}
