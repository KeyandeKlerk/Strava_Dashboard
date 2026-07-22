// One-time migration: add the gym_exercises/gym_sessions/gym_sets tables and
// seed the curated exercise library.
// Run once against the live MotherDuck database. NOT part of the deployed
// app — do not run this until the app code from this plan is ready to
// deploy alongside it (the new app code queries these tables directly).
//
// Usage:
//   MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
//     node scripts/add-gym-tables.ts
import { DuckDBInstance } from "@duckdb/node-api";
import { buildGymExerciseSeedStatements } from "../src/lib/db/gymExerciseSeed.ts";

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
  // Switch the session's default catalog to md — without this, unqualified
  // names (e.g. inside a DEFAULT nextval(...) clause, re-resolved at INSERT
  // time, not just at CREATE TABLE time) resolve against the local :memory:
  // catalog instead of md and fail with "Sequence ... does not exist".
  await conn.run("USE md");

  console.log("Creating gym_exercises");
  await conn.run("CREATE SEQUENCE IF NOT EXISTS gym_exercises_id_seq START 1");
  await conn.run(`
    CREATE TABLE IF NOT EXISTS gym_exercises (
      id INTEGER PRIMARY KEY DEFAULT nextval('gym_exercises_id_seq'),
      client_uuid VARCHAR UNIQUE,
      name VARCHAR NOT NULL UNIQUE,
      muscle_group VARCHAR NOT NULL,
      equipment VARCHAR,
      is_custom BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT current_timestamp
    )
  `);

  console.log("Creating gym_sessions");
  await conn.run("CREATE SEQUENCE IF NOT EXISTS gym_sessions_id_seq START 1");
  await conn.run(`
    CREATE TABLE IF NOT EXISTS gym_sessions (
      id INTEGER PRIMARY KEY DEFAULT nextval('gym_sessions_id_seq'),
      client_uuid VARCHAR NOT NULL UNIQUE,
      session_date DATE NOT NULL,
      started_at TIMESTAMP,
      ended_at TIMESTAMP,
      activity_id BIGINT,
      notes VARCHAR,
      created_at TIMESTAMP DEFAULT current_timestamp
    )
  `);

  console.log("Creating gym_sets");
  await conn.run("CREATE SEQUENCE IF NOT EXISTS gym_sets_id_seq START 1");
  await conn.run(`
    CREATE TABLE IF NOT EXISTS gym_sets (
      id INTEGER PRIMARY KEY DEFAULT nextval('gym_sets_id_seq'),
      client_uuid VARCHAR NOT NULL UNIQUE,
      session_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      set_number INTEGER NOT NULL,
      weight_kg DOUBLE NOT NULL,
      reps INTEGER NOT NULL,
      logged_at TIMESTAMP DEFAULT current_timestamp
    )
  `);

  console.log("Seeding exercise library");
  for (const statement of buildGymExerciseSeedStatements()) {
    await conn.run(statement);
  }

  conn.closeSync();
  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
