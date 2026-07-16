# Strava Training Dashboard (Next.js)

Mobile-first, installable PWA rewrite of the Streamlit training dashboard, deployed on
Vercel with MotherDuck (hosted DuckDB) as the data store.

- **Pages**: Today, Fatigue, Training Load, Aerobic, Race Prep, Plan & History — ported
  from `dashboard/tabs/*.py`.
- **Data**: `src/lib/db` (schema + MotherDuck client), `src/lib/metrics.ts` (TypeScript
  port of `src/metrics.py`, with a Vitest parity suite in `src/lib/metrics.test.ts`).
- **Sync**: `src/lib/strava/*` ports the Python sync/backfill pipeline; the Strava
  webhook lands at `app/api/webhook/strava/route.ts`.
- **Auth**: a single-password gate (`src/proxy.ts` + `src/lib/auth.ts`) — not a
  multi-user system.
- **PWA**: `src/app/manifest.ts` + a Serwist service worker (`src/app/sw.ts`) for
  installability and offline (stale-while-revalidate) reads.

## Getting started locally

```bash
npm install
cp .env.example .env.local   # fill in values, or leave DUCKDB_DATABASE_URL unset for :memory:
npm run dev
```

## Testing

```bash
npm test          # Vitest — metrics parity suite
npx tsc --noEmit  # typecheck
npm run build     # production build (also typechecks + bundles the service worker)
```

## Deploying

See [`SETUP.md`](./SETUP.md) for the one-time steps that need real credentials/accounts
(MotherDuck, Strava app, Vercel, webhook re-pointing) and can't be automated from here.
