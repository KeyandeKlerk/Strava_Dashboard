# Setup & Cutover Guide

Steps in this doc require your own accounts/credentials and can't be automated.
Everything else (schema, metrics, sync logic, pages) is already built and tested
in this repo.

## 1. Create a MotherDuck database

1. Sign up at https://motherduck.com and create a database (e.g. `strava_dashboard`).
2. Generate a service token from the MotherDuck UI (Settings → Tokens).
3. Your connection string is:
   ```
   md:strava_dashboard?motherduck_token=<token>
   ```

## 2. Migrate existing data

Run the one-time migration script locally (reads your existing local DuckDB
file, writes to MotherDuck, verifies row counts match):

```bash
cd web
MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
  npx tsx scripts/migrate-to-motherduck.ts ../data/training.duckdb
```

Confirm it prints "Migration complete — all row counts match." before proceeding.

## 3. Configure environment variables

Copy `.env.example` to `.env.local` for local dev, and set the same values in
Vercel's project settings (Settings → Environment Variables) for production:

| Variable | Value |
|---|---|
| `DUCKDB_DATABASE_URL` | `md:strava_dashboard?motherduck_token=<token>` |
| `STRAVA_CLIENT_ID` | from your Strava API application |
| `STRAVA_CLIENT_SECRET` | from your Strava API application |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | any random string you choose |
| `SITE_PASSWORD` | the password you want to gate the dashboard with |
| `SESSION_SECRET` | a long random string, e.g. `openssl rand -hex 32` |

## 4. Deploy to Vercel

```bash
npx vercel link
npx vercel --prod
```

Or connect the GitHub repo in the Vercel dashboard for auto-deploys on push.

## 5. Re-point the Strava webhook subscription

Strava allows one webhook subscription per application. Delete the old one
(pointed at the Fly.io deployment) and create a new one pointed at your Vercel
deployment:

```bash
# Delete the existing subscription (find its id first: GET .../push_subscriptions)
curl -X DELETE "https://www.strava.com/api/v3/push_subscriptions/<id>" \
  -F client_id=<STRAVA_CLIENT_ID> -F client_secret=<STRAVA_CLIENT_SECRET>

# Create the new one
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=<STRAVA_CLIENT_ID> \
  -F client_secret=<STRAVA_CLIENT_SECRET> \
  -F callback_url=https://<your-vercel-domain>/api/webhook/strava \
  -F verify_token=<STRAVA_WEBHOOK_VERIFY_TOKEN>
```

Strava will hit the callback URL with a verification challenge — the route
handler responds to this automatically.

## 6. Verify end-to-end

- Log a real (or manually-triggered test) Strava activity and confirm it
  appears on `/plan-history` and updates `/fatigue` and `/training-load`
  within a few seconds.
- Open the deployed site on your phone, add it to the home screen, and
  confirm it opens standalone (no browser chrome).
- Turn on airplane mode and confirm previously-loaded pages still render
  with a "last synced at" indicator.
- Confirm visiting the site without the password cookie redirects to
  `/login`.

## 7. Retire Fly.io

Once the above is verified for a few real activities:

```bash
fly apps destroy <app-name>
```

This also removes the Fly volume holding the old local DuckDB file — make
sure the MotherDuck migration (step 2) is confirmed correct first, since
that's your only remaining copy of the data after this point.

## Known gaps vs. the Streamlit version

- **Periodization plan-builder not ported.** `src/periodization.py`'s `build_plan`
  (generates a full periodized weekly plan from a race date + race calendar) is a
  separate engine from the sync/race-detection logic and wasn't ported — it was out
  of scope for this migration. Race Prep's "Add race" form saves the race but does
  **not** regenerate the training plan the way the old "Save & rebuild plan" button
  did. Use CSV import on Plan & History for now, or port `build_plan` as a follow-up
  (it's pure computation, no I/O beyond the existing `db` mutation helpers, so it
  should translate to TypeScript the same way `metrics.py` did).
- **No OLS trendlines.** A few charts in the old dashboard (pace trend, EF trend,
  quality score) drew a regression trendline via Plotly/statsmodels. The Recharts
  ports show the same data without the fitted line — visual judgment call, not a
  missing dependency that's hard to add if wanted.
