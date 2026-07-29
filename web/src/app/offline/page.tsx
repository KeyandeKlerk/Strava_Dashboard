// Static (no data fetching) so it's part of the build's precache manifest —
// required by Serwist's fallbacks config (src/app/sw.ts), which can only
// fall back to a URL that's already been precached.
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold">You&apos;re offline</h1>
      <p className="mt-2 text-sm text-neutral-500">
        This page needs a connection. Gym logging still works offline — head to the Gym tab.
      </p>
    </div>
  );
}
