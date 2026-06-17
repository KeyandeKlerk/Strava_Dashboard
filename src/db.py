import duckdb
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent.parent / "data" / "training.duckdb"


def get_conn() -> duckdb.DuckDBPyConnection:
    DB_PATH.parent.mkdir(exist_ok=True)
    return duckdb.connect(str(DB_PATH))


def init_schema(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS activities (
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
            synced_at TIMESTAMP DEFAULT current_timestamp
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS activity_streams_derived (
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
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS training_plan (
            week_number INTEGER PRIMARY KEY,
            week_start_date DATE,
            phase VARCHAR,
            planned_distance_km DOUBLE,
            planned_long_run_km DOUBLE,
            planned_sessions INTEGER,
            is_deload BOOLEAN DEFAULT FALSE,
            notes VARCHAR
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sync_state (
            key VARCHAR PRIMARY KEY,
            value VARCHAR
        )
    """)


def upsert_activity(conn: duckdb.DuckDBPyConnection, activity: dict) -> None:
    conn.execute("""
        INSERT INTO activities (
            id, name, sport_type, category, start_date_local,
            distance_km, moving_time_min, elapsed_time_min, elevation_gain_m,
            average_heartrate, max_heartrate, average_cadence, average_speed_kmh,
            relative_effort, load_score, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
        ON CONFLICT (id) DO UPDATE SET
            name = excluded.name,
            sport_type = excluded.sport_type,
            category = excluded.category,
            start_date_local = excluded.start_date_local,
            distance_km = excluded.distance_km,
            moving_time_min = excluded.moving_time_min,
            elapsed_time_min = excluded.elapsed_time_min,
            elevation_gain_m = excluded.elevation_gain_m,
            average_heartrate = excluded.average_heartrate,
            max_heartrate = excluded.max_heartrate,
            average_cadence = excluded.average_cadence,
            average_speed_kmh = excluded.average_speed_kmh,
            relative_effort = excluded.relative_effort,
            load_score = excluded.load_score,
            synced_at = now()
    """, [
        activity["id"], activity.get("name"), activity.get("sport_type"),
        activity.get("category"), activity.get("start_date_local"),
        activity.get("distance_km"), activity.get("moving_time_min"),
        activity.get("elapsed_time_min"), activity.get("elevation_gain_m"),
        activity.get("average_heartrate"), activity.get("max_heartrate"),
        activity.get("average_cadence"), activity.get("average_speed_kmh"),
        activity.get("relative_effort"), activity.get("load_score"),
    ])


def upsert_streams_derived(conn: duckdb.DuckDBPyConnection, derived: dict) -> None:
    conn.execute("""
        INSERT INTO activity_streams_derived (
            activity_id, elevation_loss_m, decoupling_pct,
            pct_time_z1, pct_time_z2, pct_time_z3, pct_time_z4, pct_time_z5,
            grade_adjusted_pace, cadence_avg
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (activity_id) DO UPDATE SET
            elevation_loss_m = excluded.elevation_loss_m,
            decoupling_pct = excluded.decoupling_pct,
            pct_time_z1 = excluded.pct_time_z1,
            pct_time_z2 = excluded.pct_time_z2,
            pct_time_z3 = excluded.pct_time_z3,
            pct_time_z4 = excluded.pct_time_z4,
            pct_time_z5 = excluded.pct_time_z5,
            grade_adjusted_pace = excluded.grade_adjusted_pace,
            cadence_avg = excluded.cadence_avg
    """, [
        derived["activity_id"], derived.get("elevation_loss_m"), derived.get("decoupling_pct"),
        derived.get("pct_time_z1"), derived.get("pct_time_z2"), derived.get("pct_time_z3"),
        derived.get("pct_time_z4"), derived.get("pct_time_z5"),
        derived.get("grade_adjusted_pace"), derived.get("cadence_avg"),
    ])


def upsert_training_plan_week(conn: duckdb.DuckDBPyConnection, week: dict) -> None:
    conn.execute("""
        INSERT INTO training_plan (
            week_number, week_start_date, phase, planned_distance_km,
            planned_long_run_km, planned_sessions, is_deload, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (week_number) DO UPDATE SET
            week_start_date = excluded.week_start_date,
            phase = excluded.phase,
            planned_distance_km = excluded.planned_distance_km,
            planned_long_run_km = excluded.planned_long_run_km,
            planned_sessions = excluded.planned_sessions,
            is_deload = excluded.is_deload,
            notes = excluded.notes
    """, [
        week["week_number"], week.get("week_start_date"), week.get("phase"),
        week.get("planned_distance_km"), week.get("planned_long_run_km"),
        week.get("planned_sessions"), week.get("is_deload", False), week.get("notes"),
    ])


def get_last_synced(conn: duckdb.DuckDBPyConnection) -> Optional[int]:
    result = conn.execute(
        "SELECT value FROM sync_state WHERE key = 'last_synced_at'"
    ).fetchone()
    return int(result[0]) if result else None


def set_last_synced(conn: duckdb.DuckDBPyConnection, timestamp: int) -> None:
    conn.execute("""
        INSERT INTO sync_state (key, value) VALUES ('last_synced_at', ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
    """, [str(timestamp)])
