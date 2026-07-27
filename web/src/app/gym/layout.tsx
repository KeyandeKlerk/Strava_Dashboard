import { ViewTransition } from "react";
import { BottomNav } from "@/components/BottomNav";
import { GymOfflineProvider } from "@/lib/gymOffline/context";
import { GymStatusHeader } from "@/components/gym/GymStatusHeader";
import { GymTabBar } from "@/components/gym/GymTabBar";

// Deliberately NOT under (dashboard) and NOT force-dynamic: that layout does
// a DB call on every request, which combined with BottomNav's plain-<a>
// full-page navigations means a cold PWA launch straight into a page under
// it cannot render with zero connectivity. This shell has no server-side
// data fetch, so it stays static/precacheable — all dynamic content loads
// client-side via GymOfflineProvider, which falls back to its IndexedDB
// cache when offline. See docs/superpowers/specs (gym tracker plan) for the
// full reasoning.
export default function GymLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4">
        <GymOfflineProvider>
          <div style={{ viewTransitionName: "site-header" }}>
            <GymStatusHeader />
          </div>
          <GymTabBar />
          <ViewTransition name="tab-content" share="tab-crossfade" enter="suspense-reveal" default="none">
            {children}
          </ViewTransition>
        </GymOfflineProvider>
      </main>
      <BottomNav />
    </div>
  );
}
