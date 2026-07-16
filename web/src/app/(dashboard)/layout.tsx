import { BottomNav } from "@/components/BottomNav";

// Without this, Next statically prerenders these pages at build time (no
// cookies/headers/searchParams access triggers the auto-static heuristic),
// freezing the dashboard's DB-backed data until the next deploy.
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-20 pt-4">{children}</main>
      <BottomNav />
    </div>
  );
}
