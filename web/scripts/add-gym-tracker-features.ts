// One-time migration: add new columns to gym_sets and gym_plan_exercises,
// plus the body_weight_logs table for the gym tracker feature expansion.
// Run once against the live MotherDuck database. NOT part of the deployed
// app — do not run this until the app code that queries these tables is ready
// to deploy alongside it.
//
// Self-contained (no local imports), same convention as add-gym-tables.ts —
// see that script's header comment for why.
//
// Usage:
//   MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
//     node scripts/add-gym-tracker-features.ts
import { DuckDBInstance } from "@duckdb/node-api";

async function main() {
  const motherduckUrl = process.env.MOTHERDUCK_DATABASE_URL;
  if (!motherduckUrl) {
    console.error("MOTHERDUCK_DATABASE_URL is required, e.g. md:strava_dashboard?motherduck_token=<token>");
    process.exit(1);
  }

  const match = motherduckUrl.match(/^md:([^?]+)(?:\?motherduck_token=(.+))?$/);
  if (!match) {
    console.error(`MOTHERDUCK_DATABASE_URL must look like md:<dbname>?motherduck_token=<token>, got: ${motherduckUrl}`);
    process.exit(1);
  }
  const [, dbName, token] = match;
  if (token) process.env.motherduck_token = token;

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  console.log("Attaching MotherDuck DB");
  await conn.run(`ATTACH 'md:${dbName}' AS md`);
  await conn.run("USE md");

  console.log("Adding columns to gym_sets");
  await conn.run("ALTER TABLE gym_sets ADD COLUMN IF NOT EXISTS is_warmup BOOLEAN DEFAULT FALSE");
  await conn.run("ALTER TABLE gym_sets ADD COLUMN IF NOT EXISTS rpe DOUBLE");

  console.log("Adding columns to gym_plan_exercises");
  await conn.run("ALTER TABLE gym_plan_exercises ADD COLUMN IF NOT EXISTS target_sets INTEGER");
  await conn.run("ALTER TABLE gym_plan_exercises ADD COLUMN IF NOT EXISTS target_reps INTEGER");
  await conn.run("ALTER TABLE gym_plan_exercises ADD COLUMN IF NOT EXISTS superset_group INTEGER");

  console.log("Creating body_weight_logs");
  await conn.run("CREATE SEQUENCE IF NOT EXISTS body_weight_logs_id_seq START 1");
  await conn.run(`
    CREATE TABLE IF NOT EXISTS body_weight_logs (
      id INTEGER PRIMARY KEY DEFAULT nextval('body_weight_logs_id_seq'),
      client_uuid VARCHAR UNIQUE,
      logged_date DATE NOT NULL,
      weight_kg DOUBLE NOT NULL,
      created_at TIMESTAMP DEFAULT current_timestamp
    )
  `);

  conn.closeSync();
  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
