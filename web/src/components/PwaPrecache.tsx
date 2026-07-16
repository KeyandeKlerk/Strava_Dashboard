"use client";
import { useEffect } from "react";
import { NAV_ITEMS } from "@/lib/nav";

// Must match the cache name the service worker's CacheFirst rule reads from
// (src/app/sw.ts) — this component is the only thing that ever writes to it.
const DASHBOARD_CACHE_NAME = "dashboard-pages";
const LAST_PRECACHED_KEY = "dashboardPrecachedSyncedAt";

// Precaches every dashboard tab so they all work offline, even ones never
// manually visited — and only re-fetches them when a sync has actually
// happened (compares against /api/sync-status), not on every page load.
export function PwaPrecache() {
  useEffect(() => {
    if (!("caches" in window)) return;

    let cancelled = false;

    async function run() {
      let lastSyncedAt: number | null;
      try {
        const res = await fetch("/api/sync-status", { cache: "no-store" });
        if (!res.ok) return;
        ({ lastSyncedAt } = await res.json());
      } catch {
        return; // offline or request failed — nothing to refresh right now
      }

      const stored = localStorage.getItem(LAST_PRECACHED_KEY);
      if (stored !== null && Number(stored) === lastSyncedAt) return; // no new sync since last precache

      const cache = await caches.open(DASHBOARD_CACHE_NAME);
      await Promise.all(
        NAV_ITEMS.map(async ({ href }) => {
          try {
            const pageRes = await fetch(href, { cache: "no-store" });
            if (pageRes.ok) await cache.put(href, pageRes);
          } catch {
            // leave whatever's already cached for this route alone
          }
        }),
      );

      if (!cancelled) localStorage.setItem(LAST_PRECACHED_KEY, String(lastSyncedAt));
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
