// Service worker source, compiled by @serwist/next's webpack plugin into
// public/sw.js. Excluded from the main tsconfig (needs "webworker" lib,
// which conflicts with the app's "dom" lib) — see tsconfig.json.
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // Stale-while-revalidate (in defaultCache) for pages/data means the app
  // renders the last-synced view immediately when offline, then updates in
  // the background the next time it has a connection.
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
