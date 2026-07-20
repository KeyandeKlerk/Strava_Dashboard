// One-time migration: generalize the race engine away from Comrades-only
// hardcoding. Adds terrain_factor/cutoff_h to race_events (per-race
// configuration instead of a single hardcoded constant) and renames
// race_analysis.comrades_projection_h -> projected_finish_h (the column
// stores a projection for whatever the primary goal race is, not always
// Comrades). Run once against the live MotherDuck database. NOT part of
// the deployed app — do not run this until the app code from this plan is
// ready to deploy alongside it (the new app code queries projected_finish_h/
// terrain_factor/cutoff_h directly).
//
// Usage:
//   MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
//     node scripts/generalize-race-engine.ts
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

  console.log("Adding race_events.terrain_factor / cutoff_h");
  await conn.run("ALTER TABLE md.race_events ADD COLUMN IF NOT EXISTS terrain_factor DOUBLE DEFAULT 1.0");
  await conn.run("ALTER TABLE md.race_events ADD COLUMN IF NOT EXISTS cutoff_h DOUBLE");

  console.log("Checking race_analysis column name");
  const columns = await conn.runAndReadAll(
    "SELECT column_name FROM duckdb_columns() WHERE database_name = 'md' AND table_name = 'race_analysis'",
  );
  const columnNames = columns.getRowObjectsJS().map((r) => r.column_name);
  if (columnNames.includes("comrades_projection_h")) {
    console.log("Renaming race_analysis.comrades_projection_h -> projected_finish_h");
    await conn.run("ALTER TABLE md.race_analysis RENAME COLUMN comrades_projection_h TO projected_finish_h");
  } else {
    console.log("race_analysis already has projected_finish_h — skipping rename");
  }

  conn.closeSync();
  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
