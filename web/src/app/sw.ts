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

// Dashboard pages used to have a custom CacheFirst rule so they'd work
// offline, but that meant a page could keep serving a stale pre-sync
// snapshot indefinitely regardless of reloads. defaultCache's own handling
// of page navigations is NetworkFirst (network unless offline), which is
// what we actually want — always fetch fresh, so removed the override.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [...defaultCache],
});

serwist.addEventListeners();
