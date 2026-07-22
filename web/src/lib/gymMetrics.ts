// Gym tracker insights aggregations. Kept separate from metrics.ts (1200+
// lines, all ported from src/metrics.py) since gym has no Python precedent
// and never joins the running/fatigue tables directly.
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRows } from "./db/client";

// Epley formula. Isolated as a pure function so swapping to Brzycki/Lombardi
// later is a one-line change — but note the SQL aggregations below inline
// the same formula (SQL can't call a JS function), so keep them in sync.
export function estimatedOneRepMax(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

export interface ExerciseProgressionRow {
  session_date: string;
  top_weight_kg: number;
  best_est_1rm: number;
}

// top_weight_kg and best_est_1rm are independent maxima across a session's
// sets for this exercise — they can come from different sets (a heavy
// low-rep set vs. a lighter higher-rep set with a better estimated 1RM), not
// "the best set"'s two properties.
export async function exerciseProgression(conn: DuckDBConnection, exerciseId: number): Promise<ExerciseProgressionRow[]> {
  return queryRows<ExerciseProgressionRow>(
    conn,
    `SELECT
        gs.session_date::VARCHAR AS session_date,
        MAX(st.weight_kg) AS top_weight_kg,
        MAX(st.weight_kg * (1 + st.reps / 30.0)) AS best_est_1rm
     FROM gym_sets st
     JOIN gym_sessions gs ON gs.id = st.session_id
     WHERE st.exercise_id = $exercise_id
     GROUP BY gs.session_date
     ORDER BY gs.session_date`,
    { exercise_id: exerciseId },
  );
}

export interface PersonalRecordRow {
  exercise_id: number;
  exercise_name: string;
  max_weight_kg: number;
  max_weight_date: string;
  best_est_1rm: number;
  best_est_1rm_date: string;
}

export async function personalRecords(conn: DuckDBConnection): Promise<PersonalRecordRow[]> {
  return queryRows<PersonalRecordRow>(
    conn,
    `WITH set_stats AS (
        SELECT
            st.exercise_id,
            st.weight_kg,
            st.weight_kg * (1 + st.reps / 30.0) AS est_1rm,
            gs.session_date::VARCHAR AS session_date
        FROM gym_sets st
        JOIN gym_sessions gs ON gs.id = st.session_id
     )
     SELECT
        ge.id AS exercise_id,
        ge.name AS exercise_name,
        ARG_MAX(ss.weight_kg, ss.weight_kg) AS max_weight_kg,
        ARG_MAX(ss.session_date, ss.weight_kg) AS max_weight_date,
        ARG_MAX(ss.est_1rm, ss.est_1rm) AS best_est_1rm,
        ARG_MAX(ss.session_date, ss.est_1rm) AS best_est_1rm_date
     FROM set_stats ss
     JOIN gym_exercises ge ON ge.id = ss.exercise_id
     GROUP BY ge.id, ge.name
     ORDER BY ge.name`,
  );
}

export interface SessionVolumeRow {
  session_id: number;
  session_date: string;
  total_volume_kg: number;
}

export async function sessionVolume(conn: DuckDBConnection): Promise<SessionVolumeRow[]> {
  return queryRows<SessionVolumeRow>(
    conn,
    `SELECT gs.id AS session_id, gs.session_date::VARCHAR AS session_date,
            COALESCE(SUM(st.weight_kg * st.reps), 0) AS total_volume_kg
     FROM gym_sessions gs
     LEFT JOIN gym_sets st ON st.session_id = gs.id
     GROUP BY gs.id, gs.session_date
     ORDER BY gs.session_date`,
  );
}

export interface WeeklyGymVolumeRow {
  week_start: string;
  total_volume_kg: number;
}

export async function weeklyGymVolume(conn: DuckDBConnection): Promise<WeeklyGymVolumeRow[]> {
  return queryRows<WeeklyGymVolumeRow>(
    conn,
    `SELECT DATE_TRUNC('week', gs.session_date)::VARCHAR AS week_start,
            COALESCE(SUM(st.weight_kg * st.reps), 0) AS total_volume_kg
     FROM gym_sessions gs
     LEFT JOIN gym_sets st ON st.session_id = gs.id
     GROUP BY 1
     ORDER BY 1`,
  );
}

export interface MuscleGroupWeeklyVolumeRow {
  week_start: string;
  muscle_group: string;
  total_volume_kg: number;
}

export async function muscleGroupWeeklyVolume(conn: DuckDBConnection): Promise<MuscleGroupWeeklyVolumeRow[]> {
  return queryRows<MuscleGroupWeeklyVolumeRow>(
    conn,
    `SELECT DATE_TRUNC('week', gs.session_date)::VARCHAR AS week_start,
            ge.muscle_group,
            SUM(st.weight_kg * st.reps) AS total_volume_kg
     FROM gym_sets st
     JOIN gym_sessions gs ON gs.id = st.session_id
     JOIN gym_exercises ge ON ge.id = st.exercise_id
     GROUP BY 1, 2
     ORDER BY 1, 2`,
  );
}

export interface GymSessionsPerWeekRow {
  week_start: string;
  session_count: number;
}

export async function gymSessionsPerWeek(conn: DuckDBConnection): Promise<GymSessionsPerWeekRow[]> {
  return queryRows<GymSessionsPerWeekRow>(
    conn,
    `SELECT DATE_TRUNC('week', session_date)::VARCHAR AS week_start, COUNT(*)::INTEGER AS session_count
     FROM gym_sessions
     GROUP BY 1
     ORDER BY 1`,
  );
}

export interface MuscleGroupFrequencyRow {
  muscle_group: string;
  last_trained_date: string | null;
  sessions_last_4_weeks: number;
}

export async function muscleGroupFrequency(conn: DuckDBConnection): Promise<MuscleGroupFrequencyRow[]> {
  return queryRows<MuscleGroupFrequencyRow>(
    conn,
    `SELECT
        ge.muscle_group,
        MAX(gs.session_date)::VARCHAR AS last_trained_date,
        COUNT(DISTINCT CASE WHEN gs.session_date >= CURRENT_DATE - INTERVAL 28 DAY THEN gs.session_date END)::INTEGER
            AS sessions_last_4_weeks
     FROM gym_exercises ge
     LEFT JOIN gym_sets st ON st.exercise_id = ge.id
     LEFT JOIN gym_sessions gs ON gs.id = st.session_id
     GROUP BY ge.muscle_group
     ORDER BY ge.muscle_group`,
  );
}
