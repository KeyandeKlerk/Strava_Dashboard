// One-time migration: add activities.description ahead of the "recent
// activity refresh" feature deploy. That feature's schema.ts adds this
// column via SCHEMA_STATEMENTS, but client.ts's getConnection() only runs
// initSchema() when !usingMotherDuck — i.e. only for local DuckDB files,
// never against a live MotherDuck database (DUCKDB_DATABASE_URL set). So in
// production the column never gets created automatically. Run this once
// against the live MotherDuck database BEFORE deploying the app code that
// references activities.description (upsertActivity's INSERT and
// refreshRecentActivities's SELECT both name the column, so a sync run
// against a database missing it will throw a DuckDB binder error).
//
// Usage:
//   MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
//     node scripts/add-activity-description-column.ts
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

  console.log("Adding activities.description");
  await conn.run("ALTER TABLE md.activities ADD COLUMN IF NOT EXISTS description TEXT");

  conn.closeSync();
  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
