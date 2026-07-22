// One-time migration: add the gym_exercises/gym_sessions/gym_sets tables and
// seed the curated exercise library.
// Run once against the live MotherDuck database. NOT part of the deployed
// app — do not run this until the app code from this plan is ready to
// deploy alongside it (the new app code queries these tables directly).
//
// Self-contained (no local imports) like add-niggle-log-table.ts, rather
// than importing web/src/lib/db/gymExerciseSeed.ts: Next's tsc build
// (moduleResolution: bundler) rejects an explicit ".ts" import extension,
// but a plain `node scripts/add-gym-tables.ts` run needs one to resolve a
// relative import at all — this seed list is duplicated here to sidestep
// that conflict entirely. Keep it in sync with gymExerciseSeed.ts's
// GYM_EXERCISE_SEED by hand if either changes.
//
// Usage:
//   MOTHERDUCK_DATABASE_URL="md:strava_dashboard?motherduck_token=<token>" \
//     node scripts/add-gym-tables.ts
import { DuckDBInstance } from "@duckdb/node-api";

const GYM_EXERCISE_SEED: ReadonlyArray<{ name: string; muscle_group: string; equipment?: string }> = [
  // Chest
  { name: "Barbell Bench Press", muscle_group: "Chest", equipment: "barbell" },
  { name: "Incline Barbell Bench Press", muscle_group: "Chest", equipment: "barbell" },
  { name: "Dumbbell Bench Press", muscle_group: "Chest", equipment: "dumbbell" },
  { name: "Incline Dumbbell Press", muscle_group: "Chest", equipment: "dumbbell" },
  { name: "Machine Chest Press", muscle_group: "Chest", equipment: "machine" },
  { name: "Cable Fly", muscle_group: "Chest", equipment: "cable" },
  { name: "Push-Up", muscle_group: "Chest", equipment: "bodyweight" },
  { name: "Dip", muscle_group: "Chest", equipment: "bodyweight" },
  // Lats / Upper Back
  { name: "Pull-Up", muscle_group: "Lats", equipment: "bodyweight" },
  { name: "Chin-Up", muscle_group: "Lats", equipment: "bodyweight" },
  { name: "Lat Pulldown", muscle_group: "Lats", equipment: "cable" },
  { name: "Barbell Row", muscle_group: "Upper Back", equipment: "barbell" },
  { name: "Pendlay Row", muscle_group: "Upper Back", equipment: "barbell" },
  { name: "Dumbbell Row", muscle_group: "Upper Back", equipment: "dumbbell" },
  { name: "Seated Cable Row", muscle_group: "Upper Back", equipment: "cable" },
  { name: "T-Bar Row", muscle_group: "Upper Back", equipment: "barbell" },
  { name: "Face Pull", muscle_group: "Upper Back", equipment: "cable" },
  // Traps
  { name: "Barbell Shrug", muscle_group: "Traps", equipment: "barbell" },
  { name: "Dumbbell Shrug", muscle_group: "Traps", equipment: "dumbbell" },
  // Quads
  { name: "Barbell Back Squat", muscle_group: "Quads", equipment: "barbell" },
  { name: "Barbell Front Squat", muscle_group: "Quads", equipment: "barbell" },
  { name: "Leg Press", muscle_group: "Quads", equipment: "machine" },
  { name: "Walking Lunge", muscle_group: "Quads", equipment: "dumbbell" },
  { name: "Bulgarian Split Squat", muscle_group: "Quads", equipment: "dumbbell" },
  { name: "Leg Extension", muscle_group: "Quads", equipment: "machine" },
  { name: "Goblet Squat", muscle_group: "Quads", equipment: "dumbbell" },
  // Hamstrings
  { name: "Romanian Deadlift", muscle_group: "Hamstrings", equipment: "barbell" },
  { name: "Leg Curl", muscle_group: "Hamstrings", equipment: "machine" },
  { name: "Good Morning", muscle_group: "Hamstrings", equipment: "barbell" },
  // Glutes
  { name: "Hip Thrust", muscle_group: "Glutes", equipment: "barbell" },
  { name: "Cable Kickback", muscle_group: "Glutes", equipment: "cable" },
  { name: "Conventional Deadlift", muscle_group: "Glutes", equipment: "barbell" },
  // Calves
  { name: "Standing Calf Raise", muscle_group: "Calves", equipment: "machine" },
  { name: "Seated Calf Raise", muscle_group: "Calves", equipment: "machine" },
  // Shoulders
  { name: "Overhead Press", muscle_group: "Shoulders", equipment: "barbell" },
  { name: "Dumbbell Shoulder Press", muscle_group: "Shoulders", equipment: "dumbbell" },
  { name: "Lateral Raise", muscle_group: "Shoulders", equipment: "dumbbell" },
  { name: "Front Raise", muscle_group: "Shoulders", equipment: "dumbbell" },
  { name: "Rear Delt Fly", muscle_group: "Shoulders", equipment: "dumbbell" },
  { name: "Arnold Press", muscle_group: "Shoulders", equipment: "dumbbell" },
  // Biceps
  { name: "Barbell Curl", muscle_group: "Biceps", equipment: "barbell" },
  { name: "Dumbbell Curl", muscle_group: "Biceps", equipment: "dumbbell" },
  { name: "Hammer Curl", muscle_group: "Biceps", equipment: "dumbbell" },
  { name: "Preacher Curl", muscle_group: "Biceps", equipment: "barbell" },
  { name: "Cable Curl", muscle_group: "Biceps", equipment: "cable" },
  // Triceps
  { name: "Close-Grip Bench Press", muscle_group: "Triceps", equipment: "barbell" },
  { name: "Triceps Pushdown", muscle_group: "Triceps", equipment: "cable" },
  { name: "Overhead Triceps Extension", muscle_group: "Triceps", equipment: "dumbbell" },
  { name: "Skull Crusher", muscle_group: "Triceps", equipment: "barbell" },
  // Core
  { name: "Plank", muscle_group: "Core", equipment: "bodyweight" },
  { name: "Hanging Leg Raise", muscle_group: "Core", equipment: "bodyweight" },
  { name: "Cable Crunch", muscle_group: "Core", equipment: "cable" },
  { name: "Ab Wheel Rollout", muscle_group: "Core", equipment: "other" },
  // Forearms
  { name: "Farmer's Walk", muscle_group: "Forearms", equipment: "dumbbell" },
  { name: "Wrist Curl", muscle_group: "Forearms", equipment: "barbell" },
];

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function buildGymExerciseSeedStatements(): string[] {
  return GYM_EXERCISE_SEED.map((row) => {
    const equipment = row.equipment ? `'${escapeSqlLiteral(row.equipment)}'` : "NULL";
    return `INSERT INTO gym_exercises (name, muscle_group, equipment, is_custom) VALUES ('${escapeSqlLiteral(
      row.name,
    )}', '${escapeSqlLiteral(row.muscle_group)}', ${equipment}, FALSE) ON CONFLICT (name) DO NOTHING`;
  });
}

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
