// One-time migration: copy every table from the local DuckDB file
// (data/training.duckdb) into a MotherDuck-hosted database, then verify row
// counts match. Run locally once, before cutover — this is NOT part of the
// deployed app (see the ordering/decisions in SETUP.md).
//
// Usage:
//   MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
//     node scripts/migrate-to-motherduck.ts [path/to/training.duckdb]
//
// Table list is duplicated (not imported) from src/lib/db/schema.ts so this
// script has no dependency on the app's TS module graph — it's a standalone
// one-off tool.
import { DuckDBInstance } from "@duckdb/node-api";

const TABLES_IN_ORDER = [
  "activities",
  "activity_streams_derived",
  "hr_zones",
  "training_plan",
  "training_plan_daily",
  "sync_state",
  "race_events",
  "race_analysis",
  "training_blocks",
  "gear",
];

const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS activities (
    id BIGINT PRIMARY KEY, name VARCHAR, sport_type VARCHAR, category VARCHAR,
    start_date_local TIMESTAMP, distance_km DOUBLE, moving_time_min DOUBLE,
    elapsed_time_min DOUBLE, elevation_gain_m DOUBLE, average_heartrate DOUBLE,
    max_heartrate DOUBLE, average_cadence DOUBLE, average_speed_kmh DOUBLE,
    relative_effort DOUBLE, load_score DOUBLE, gear_id VARCHAR, gear_name VARCHAR,
    synced_at TIMESTAMP DEFAULT current_timestamp
  )`,
  `CREATE TABLE IF NOT EXISTS activity_streams_derived (
    activity_id BIGINT PRIMARY KEY, elevation_loss_m DOUBLE, decoupling_pct DOUBLE,
    pct_time_z1 DOUBLE, pct_time_z2 DOUBLE, pct_time_z3 DOUBLE, pct_time_z4 DOUBLE,
    pct_time_z5 DOUBLE, grade_adjusted_pace DOUBLE, cadence_avg DOUBLE
  )`,
  `CREATE TABLE IF NOT EXISTS hr_zones (
    zone_number INTEGER PRIMARY KEY, min_bpm INTEGER, max_bpm INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS training_plan (
    week_number INTEGER PRIMARY KEY, week_start_date DATE, phase VARCHAR,
    planned_distance_km DOUBLE, planned_long_run_km DOUBLE, planned_sessions INTEGER,
    is_deload BOOLEAN DEFAULT FALSE, notes VARCHAR
  )`,
  `CREATE TABLE IF NOT EXISTS training_plan_daily (
    planned_date DATE, week_number INTEGER, day_of_week VARCHAR, session_type VARCHAR,
    planned_distance_km DOUBLE, intensity VARCHAR, description TEXT,
    is_quality BOOLEAN DEFAULT FALSE, completed BOOLEAN DEFAULT FALSE,
    completed_activity_id BIGINT, completed_distance_km DOUBLE,
    PRIMARY KEY (planned_date, session_type)
  )`,
  `CREATE TABLE IF NOT EXISTS sync_state (key VARCHAR PRIMARY KEY, value VARCHAR)`,
  `CREATE SEQUENCE IF NOT EXISTS race_events_id_seq START 1`,
  `CREATE TABLE IF NOT EXISTS race_events (
    id INTEGER PRIMARY KEY DEFAULT nextval('race_events_id_seq'), name VARCHAR NOT NULL,
    race_date DATE NOT NULL, distance_km DOUBLE NOT NULL, priority VARCHAR NOT NULL,
    target_finish_h DOUBLE, notes VARCHAR, strava_activity_id BIGINT
  )`,
  `CREATE SEQUENCE IF NOT EXISTS training_blocks_id_seq START 1`,
  `CREATE TABLE IF NOT EXISTS training_blocks (
    id INTEGER PRIMARY KEY DEFAULT nextval('training_blocks_id_seq'), block_type VARCHAR NOT NULL,
    start_date DATE NOT NULL, end_date DATE NOT NULL, target_weekly_km DOUBLE,
    phase_label VARCHAR, race_event_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS gear (
    id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, type VARCHAR DEFAULT 'road',
    added_date DATE, retire_km_threshold DOUBLE DEFAULT 800.0,
    is_retired BOOLEAN DEFAULT FALSE, notes VARCHAR
  )`,
  `CREATE TABLE IF NOT EXISTS race_analysis (
    race_event_id INTEGER PRIMARY KEY, activity_id BIGINT NOT NULL,
    avg_pace_min_km DOUBLE, comrades_projection_h DOUBLE, riegel_factor DOUBLE,
    computed_at TIMESTAMP DEFAULT current_timestamp
  )`,
];

async function main() {
  const localPath = process.argv[2] ?? "../data/training.duckdb";
  const motherduckUrl = process.env.MOTHERDUCK_DATABASE_URL;
  if (!motherduckUrl) {
    console.error("MOTHERDUCK_DATABASE_URL is required, e.g. md:strava_dashboard?motherduck_token=<token>");
    process.exit(1);
  }

  // DuckDB's motherduck extension doesn't reliably parse `?motherduck_token=`
  // as part of the ATTACH path in this version — it needs the token as its
  // own `motherduck_token` env var, with a bare `md:<dbname>` attach target.
  // Parse the documented MOTHERDUCK_DATABASE_URL format and split the two.
  const match = motherduckUrl.match(/^md:([^?]+)(?:\?motherduck_token=(.+))?$/);
  if (!match) {
    console.error(`MOTHERDUCK_DATABASE_URL must look like md:<dbname>?motherduck_token=<token>, got: ${motherduckUrl}`);
    process.exit(1);
  }
  const [, dbName, token] = match;
  if (token) process.env.motherduck_token = token;

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  console.log(`Attaching local DB: ${localPath}`);
  await conn.run(`ATTACH '${localPath}' AS local (READ_ONLY)`);
  console.log("Attaching MotherDuck DB");
  await conn.run(`ATTACH 'md:${dbName}' AS md`);

  console.log("Creating schema on MotherDuck (if not present)");
  for (const statement of SCHEMA_STATEMENTS) {
    await conn.run(statement.replace(/CREATE TABLE IF NOT EXISTS (\w+)/, "CREATE TABLE IF NOT EXISTS md.$1")
      .replace(/CREATE SEQUENCE IF NOT EXISTS (\w+)/, "CREATE SEQUENCE IF NOT EXISTS md.$1"));
  }

  const mismatches: string[] = [];
  for (const table of TABLES_IN_ORDER) {
    console.log(`Copying ${table}...`);
    await conn.run(`INSERT INTO md.${table} SELECT * FROM local.${table}`);

    const localCountReader = await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM local.${table}`);
    const mdCountReader = await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM md.${table}`);
    const localCount = localCountReader.getRowObjectsJS()[0].n;
    const mdCount = mdCountReader.getRowObjectsJS()[0].n;

    const match = localCount === mdCount;
    console.log(`  ${table}: local=${localCount} md=${mdCount} ${match ? "OK" : "MISMATCH"}`);
    if (!match) mismatches.push(table);
  }

  conn.closeSync();

  if (mismatches.length > 0) {
    console.error(`\nRow count mismatch in: ${mismatches.join(", ")}`);
    process.exit(1);
  }
  console.log("\nMigration complete — all row counts match.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
