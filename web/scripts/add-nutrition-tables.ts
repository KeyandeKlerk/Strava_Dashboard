// One-time migration: add nutrition_targets and nutrition_logs tables.
// Run once against the live MotherDuck database. NOT part of the deployed
// app — do not run this until the app code from this plan is ready to
// deploy alongside it (the new app code queries these tables directly).
//
// Usage:
//   MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
//     node scripts/add-nutrition-tables.ts
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

  console.log("Creating nutrition_targets");
  await conn.run(`
    CREATE TABLE IF NOT EXISTS md.nutrition_targets (
      id INTEGER PRIMARY KEY DEFAULT 1,
      target_carbs_g_per_hour DOUBLE NOT NULL,
      target_sodium_mg_per_hour DOUBLE NOT NULL,
      target_fluid_ml_per_hour DOUBLE,
      updated_at TIMESTAMP DEFAULT current_timestamp
    )
  `);

  console.log("Creating nutrition_logs");
  await conn.run("CREATE SEQUENCE IF NOT EXISTS md.nutrition_logs_id_seq START 1");
  await conn.run(`
    CREATE TABLE IF NOT EXISTS md.nutrition_logs (
      id INTEGER PRIMARY KEY DEFAULT nextval('nutrition_logs_id_seq'),
      activity_id BIGINT NOT NULL,
      logged_date DATE NOT NULL,
      carbs_g DOUBLE NOT NULL,
      sodium_mg DOUBLE NOT NULL,
      fluid_ml DOUBLE,
      notes VARCHAR
    )
  `);

  conn.closeSync();
  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
