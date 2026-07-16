// Service worker source, compiled by @serwist/next's webpack plugin into
// public/sw.js. Excluded from the main tsconfig (needs "webworker" lib,
// which conflicts with the app's "dom" lib) — see tsconfig.json.
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, Serwist } from "serwist";
import { NAV_ITEMS } from "@/lib/nav";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Must match DASHBOARD_CACHE_NAME in components/PwaPrecache.tsx, which is the
// only thing that ever writes/refreshes entries in this cache (on sync, via
// /api/sync-status). CacheFirst here means these routes are served straight
// from that cache — including offline — and never silently re-fetched just
// because the page was visited again.
const DASHBOARD_ROUTES = new Set(NAV_ITEMS.map((item) => item.href));

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && DASHBOARD_ROUTES.has(url.pathname),
      handler: new CacheFirst({ cacheName: "dashboard-pages" }),
    },
    // Stale-while-revalidate (in defaultCache) for everything else — static
    // assets, images, etc.
    ...defaultCache,
  ],
});

serwist.addEventListeners();
