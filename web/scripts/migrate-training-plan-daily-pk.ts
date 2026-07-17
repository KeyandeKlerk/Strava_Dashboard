// One-time migration: switch training_plan_daily's primary key from
// (planned_date, session_type) to a surrogate `id`, so a day can hold more
// than one session of the same type (e.g. two cross_training sessions).
// Run once against the live MotherDuck database. NOT part of the deployed
// app — do not run this until the app code from this plan is ready to
// deploy alongside it (the new app code queries an `id` column that only
// exists after this script runs).
//
// Usage:
//   MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
//     node scripts/migrate-training-plan-daily-pk.ts
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

  const beforeReader = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM md.training_plan_daily");
  const beforeCount = beforeReader.getRowObjectsJS()[0].n;
  console.log(`training_plan_daily currently has ${beforeCount} rows`);

  console.log("Creating id sequence and new table shape");
  await conn.run("CREATE SEQUENCE IF NOT EXISTS md.training_plan_daily_id_seq START 1");
  await conn.run(`
    CREATE TABLE md.training_plan_daily_new (
      id INTEGER PRIMARY KEY DEFAULT nextval('training_plan_daily_id_seq'),
      planned_date DATE,
      week_number INTEGER,
      day_of_week VARCHAR,
      session_type VARCHAR,
      planned_distance_km DOUBLE,
      intensity VARCHAR,
      description TEXT,
      is_quality BOOLEAN DEFAULT FALSE,
      completed BOOLEAN DEFAULT FALSE,
      completed_activity_id BIGINT,
      completed_distance_km DOUBLE
    )
  `);

  console.log("Copying rows across (generating ids)");
  await conn.run(`
    INSERT INTO md.training_plan_daily_new (
      planned_date, week_number, day_of_week, session_type, planned_distance_km,
      intensity, description, is_quality, completed, completed_activity_id, completed_distance_km
    )
    SELECT
      planned_date, week_number, day_of_week, session_type, planned_distance_km,
      intensity, description, is_quality, completed, completed_activity_id, completed_distance_km
    FROM md.training_plan_daily
  `);

  const afterReader = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM md.training_plan_daily_new");
  const afterCount = afterReader.getRowObjectsJS()[0].n;
  console.log(`training_plan_daily_new now has ${afterCount} rows`);

  if (beforeCount !== afterCount) {
    console.error(`Row count mismatch: before=${beforeCount} after=${afterCount} — aborting before touching the old table.`);
    conn.closeSync();
    process.exit(1);
  }

  console.log("Swapping tables");
  await conn.run("BEGIN TRANSACTION");
  try {
    await conn.run("DROP TABLE md.training_plan_daily");
    await conn.run("ALTER TABLE md.training_plan_daily_new RENAME TO training_plan_daily");
    await conn.run("COMMIT");
  } catch (err) {
    await conn.run("ROLLBACK");
    throw err;
  }

  conn.closeSync();
  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
