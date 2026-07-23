// One-time migration: add the gym_plan_exercises table for the recurring
// weekly gym plan feature.
// Run once against the live MotherDuck database. NOT part of the deployed
// app — do not run this until the app code that queries this table is ready
// to deploy alongside it.
//
// Self-contained (no local imports), same convention as add-gym-tables.ts —
// see that script's header comment for why.
//
// Usage:
//   MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
//     node scripts/add-gym-plan-table.ts
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

  console.log("Creating gym_plan_exercises");
  await conn.run("CREATE SEQUENCE IF NOT EXISTS gym_plan_exercises_id_seq START 1");
  await conn.run(`
    CREATE TABLE IF NOT EXISTS gym_plan_exercises (
      id INTEGER PRIMARY KEY DEFAULT nextval('gym_plan_exercises_id_seq'),
      day_of_week VARCHAR NOT NULL,
      exercise_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
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
