// Ported from src/db.py (Python/Streamlit dashboard). Table shapes are unchanged;
// this is the fresh-MotherDuck schema, so the training_plan_daily PK-migration
// block from db.py (upgrading an old single-column PK) is intentionally omitted.

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS activities (
    id BIGINT PRIMARY KEY,
    name VARCHAR,
    sport_type VARCHAR,
    category VARCHAR,
    start_date_local TIMESTAMP,
    distance_km DOUBLE,
    moving_time_min DOUBLE,
    elapsed_time_min DOUBLE,
    elevation_gain_m DOUBLE,
    average_heartrate DOUBLE,
    max_heartrate DOUBLE,
    average_cadence DOUBLE,
    average_speed_kmh DOUBLE,
    relative_effort DOUBLE,
    load_score DOUBLE,
    gear_id VARCHAR,
    gear_name VARCHAR,
    synced_at TIMESTAMP DEFAULT current_timestamp
  )`,
  `CREATE TABLE IF NOT EXISTS activity_streams_derived (
    activity_id BIGINT PRIMARY KEY,
    elevation_loss_m DOUBLE,
    decoupling_pct DOUBLE,
    pct_time_z1 DOUBLE,
    pct_time_z2 DOUBLE,
    pct_time_z3 DOUBLE,
    pct_time_z4 DOUBLE,
    pct_time_z5 DOUBLE,
    grade_adjusted_pace DOUBLE,
    cadence_avg DOUBLE
  )`,
  `CREATE TABLE IF NOT EXISTS hr_zones (
    zone_number INTEGER PRIMARY KEY,
    min_bpm INTEGER,
    max_bpm INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS training_plan (
    week_number INTEGER PRIMARY KEY,
    week_start_date DATE,
    phase VARCHAR,
    planned_distance_km DOUBLE,
    planned_long_run_km DOUBLE,
    planned_sessions INTEGER,
    is_deload BOOLEAN DEFAULT FALSE,
    notes VARCHAR
  )`,
  `CREATE SEQUENCE IF NOT EXISTS training_plan_daily_id_seq START 1`,
  `CREATE TABLE IF NOT EXISTS training_plan_daily (
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
  )`,
  `CREATE TABLE IF NOT EXISTS sync_state (
    key VARCHAR PRIMARY KEY,
    value VARCHAR
  )`,
  `CREATE SEQUENCE IF NOT EXISTS race_events_id_seq START 1`,
  `CREATE TABLE IF NOT EXISTS race_events (
    id INTEGER PRIMARY KEY DEFAULT nextval('race_events_id_seq'),
    name VARCHAR NOT NULL,
    race_date DATE NOT NULL,
    distance_km DOUBLE NOT NULL,
    priority VARCHAR NOT NULL,
    target_finish_h DOUBLE,
    notes VARCHAR,
    strava_activity_id BIGINT,
    terrain_factor DOUBLE DEFAULT 1.0,
    cutoff_h DOUBLE
  )`,
  `CREATE SEQUENCE IF NOT EXISTS training_blocks_id_seq START 1`,
  `CREATE TABLE IF NOT EXISTS training_blocks (
    id INTEGER PRIMARY KEY DEFAULT nextval('training_blocks_id_seq'),
    block_type VARCHAR NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    target_weekly_km DOUBLE,
    phase_label VARCHAR,
    race_event_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS gear (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    type VARCHAR DEFAULT 'road',
    added_date DATE,
    retire_km_threshold DOUBLE DEFAULT 800.0,
    is_retired BOOLEAN DEFAULT FALSE,
    notes VARCHAR
  )`,
  `CREATE TABLE IF NOT EXISTS race_analysis (
    race_event_id INTEGER PRIMARY KEY,
    activity_id BIGINT NOT NULL,
    avg_pace_min_km DOUBLE,
    projected_finish_h DOUBLE,
    riegel_factor DOUBLE,
    computed_at TIMESTAMP DEFAULT current_timestamp
  )`,
  `CREATE TABLE IF NOT EXISTS nutrition_targets (
    id INTEGER PRIMARY KEY DEFAULT 1,
    target_carbs_g_per_hour DOUBLE NOT NULL,
    target_sodium_mg_per_hour DOUBLE NOT NULL,
    target_fluid_ml_per_hour DOUBLE,
    updated_at TIMESTAMP DEFAULT current_timestamp
  )`,
  `CREATE SEQUENCE IF NOT EXISTS nutrition_logs_id_seq START 1`,
  `CREATE TABLE IF NOT EXISTS nutrition_logs (
    id INTEGER PRIMARY KEY DEFAULT nextval('nutrition_logs_id_seq'),
    activity_id BIGINT NOT NULL,
    logged_date DATE NOT NULL,
    carbs_g DOUBLE NOT NULL,
    sodium_mg DOUBLE NOT NULL,
    fluid_ml DOUBLE,
    notes VARCHAR
  )`,
  `CREATE SEQUENCE IF NOT EXISTS niggle_logs_id_seq START 1`,
  `CREATE TABLE IF NOT EXISTS niggle_logs (
    id INTEGER PRIMARY KEY DEFAULT nextval('niggle_logs_id_seq'),
    activity_id BIGINT NOT NULL,
    logged_date DATE NOT NULL,
    body_part VARCHAR NOT NULL,
    severity INTEGER NOT NULL,
    notes VARCHAR
  )`,
];

export async function initSchema(run: (sql: string) => Promise<unknown>): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await run(statement);
  }
}
