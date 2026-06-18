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
        CREATE TABLE IF NOT EXISTS training_plan_daily (
            planned_date          DATE PRIMARY KEY,
            week_number           INTEGER,
            day_of_week           VARCHAR,
            session_type          VARCHAR,
            planned_distance_km   DOUBLE,
            intensity             VARCHAR,
            description           TEXT,
            is_quality            BOOLEAN DEFAULT FALSE,
            completed             BOOLEAN DEFAULT FALSE,
            completed_activity_id BIGINT,
            completed_distance_km DOUBLE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sync_state (
            key VARCHAR PRIMARY KEY,
            value VARCHAR
        )
    """)
    conn.execute("""
        CREATE SEQUENCE IF NOT EXISTS race_events_id_seq START 1
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS race_events (
            id INTEGER PRIMARY KEY DEFAULT nextval('race_events_id_seq'),
            name VARCHAR NOT NULL,
            race_date DATE NOT NULL,
            distance_km DOUBLE NOT NULL,
            priority VARCHAR NOT NULL,
            target_finish_h DOUBLE,
            notes VARCHAR,
            strava_activity_id BIGINT
        )
    """)
    conn.execute("""
        CREATE SEQUENCE IF NOT EXISTS training_blocks_id_seq START 1
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS training_blocks (
            id INTEGER PRIMARY KEY DEFAULT nextval('training_blocks_id_seq'),
            block_type VARCHAR NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            target_weekly_km DOUBLE,
            phase_label VARCHAR,
            race_event_id INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS gear (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            type VARCHAR DEFAULT 'road',
            added_date DATE,
            retire_km_threshold DOUBLE DEFAULT 800.0,
            is_retired BOOLEAN DEFAULT FALSE,
            notes VARCHAR
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS race_analysis (
            race_event_id INTEGER PRIMARY KEY,
            activity_id BIGINT NOT NULL,
            avg_pace_min_km DOUBLE,
            comrades_projection_h DOUBLE,
            riegel_factor DOUBLE,
            computed_at TIMESTAMP DEFAULT current_timestamp
        )
    """)
    # Add gear columns to activities if missing
    for col, col_type in [("gear_id", "VARCHAR"), ("gear_name", "VARCHAR")]:
        try:
            conn.execute(f"ALTER TABLE activities ADD COLUMN {col} {col_type}")
        except Exception:
            pass


def upsert_activity(conn: duckdb.DuckDBPyConnection, activity: dict) -> None:
    conn.execute("""
        INSERT INTO activities (
            id, name, sport_type, category, start_date_local,
            distance_km, moving_time_min, elapsed_time_min, elevation_gain_m,
            average_heartrate, max_heartrate, average_cadence, average_speed_kmh,
            relative_effort, load_score, gear_id, gear_name, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
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
            gear_id = excluded.gear_id,
            gear_name = excluded.gear_name,
            synced_at = now()
    """, [
        activity["id"], activity.get("name"), activity.get("sport_type"),
        activity.get("category"), activity.get("start_date_local"),
        activity.get("distance_km"), activity.get("moving_time_min"),
        activity.get("elapsed_time_min"), activity.get("elevation_gain_m"),
        activity.get("average_heartrate"), activity.get("max_heartrate"),
        activity.get("average_cadence"), activity.get("average_speed_kmh"),
        activity.get("relative_effort"), activity.get("load_score"),
        activity.get("gear_id"), activity.get("gear_name"),
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


def upsert_daily_session(conn: duckdb.DuckDBPyConnection, session: dict) -> None:
    conn.execute("""
        INSERT INTO training_plan_daily (
            planned_date, week_number, day_of_week, session_type,
            planned_distance_km, intensity, description, is_quality
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (planned_date) DO UPDATE SET
            week_number         = excluded.week_number,
            day_of_week         = excluded.day_of_week,
            session_type        = excluded.session_type,
            planned_distance_km = excluded.planned_distance_km,
            intensity           = excluded.intensity,
            description         = excluded.description,
            is_quality          = excluded.is_quality
    """, [
        session["planned_date"], session["week_number"], session["day_of_week"],
        session["session_type"], session.get("planned_distance_km"),
        session["intensity"], session["description"], session.get("is_quality", False),
    ])


def correlate_activities_to_plan(conn: duckdb.DuckDBPyConnection) -> int:
    """Match Strava activities to planned sessions by date. Returns total completed count."""
    # Best run per day → running sessions
    conn.execute("""
        UPDATE training_plan_daily d
        SET completed             = TRUE,
            completed_activity_id = a.id,
            completed_distance_km = a.distance_km
        FROM (
            SELECT start_date_local::DATE AS run_date,
                   ARG_MAX(id, distance_km) AS id,
                   MAX(distance_km)         AS distance_km
            FROM activities
            WHERE category = 'running'
            GROUP BY 1
        ) a
        WHERE d.planned_date = a.run_date
          AND d.session_type IN ('easy_run', 'quality_run', 'long_run', 'hills', 'race')
    """)
    # Gym activity → S&C sessions
    conn.execute("""
        UPDATE training_plan_daily d
        SET completed             = TRUE,
            completed_activity_id = a.id
        FROM (
            SELECT start_date_local::DATE AS gym_date, MIN(id) AS id
            FROM activities WHERE category = 'gym'
            GROUP BY 1
        ) a
        WHERE d.planned_date = a.gym_date
          AND d.session_type = 'sc'
    """)
    return conn.execute(
        "SELECT COUNT(*) FROM training_plan_daily WHERE completed"
    ).fetchone()[0]


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


def upsert_race_event(conn: duckdb.DuckDBPyConnection, event: dict) -> int:
    if event.get("id"):
        conn.execute("""
            UPDATE race_events
            SET name = ?, race_date = ?, distance_km = ?, priority = ?,
                target_finish_h = ?, notes = ?
            WHERE id = ?
        """, [event["name"], event["race_date"], event["distance_km"],
              event["priority"], event.get("target_finish_h"),
              event.get("notes"), event["id"]])
        return int(event["id"])
    result = conn.execute("""
        INSERT INTO race_events (name, race_date, distance_km, priority, target_finish_h, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
    """, [event["name"], event["race_date"], event["distance_km"],
          event["priority"], event.get("target_finish_h"), event.get("notes")]).fetchone()
    return int(result[0])


def stamp_race_activity(conn: duckdb.DuckDBPyConnection, race_event_id: int, strava_activity_id: int) -> None:
    conn.execute(
        "UPDATE race_events SET strava_activity_id = ? WHERE id = ?",
        [strava_activity_id, race_event_id],
    )


def upsert_gear(conn: duckdb.DuckDBPyConnection, gear_id: str, gear_name: str) -> None:
    conn.execute(
        "INSERT INTO gear (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING",
        [gear_id, gear_name],
    )


def upsert_race_analysis(conn: duckdb.DuckDBPyConnection, analysis: dict) -> None:
    conn.execute("""
        INSERT INTO race_analysis
            (race_event_id, activity_id, avg_pace_min_km, comrades_projection_h, riegel_factor, computed_at)
        VALUES (?, ?, ?, ?, ?, now())
        ON CONFLICT (race_event_id) DO UPDATE SET
            activity_id           = excluded.activity_id,
            avg_pace_min_km       = excluded.avg_pace_min_km,
            comrades_projection_h = excluded.comrades_projection_h,
            riegel_factor         = excluded.riegel_factor,
            computed_at           = excluded.computed_at
    """, [analysis["race_event_id"], analysis["activity_id"],
          analysis.get("avg_pace_min_km"), analysis["comrades_projection_h"],
          analysis.get("riegel_factor")])


def get_all_race_events(conn: duckdb.DuckDBPyConnection) -> list[dict]:
    rows = conn.execute("""
        SELECT id, name, race_date, distance_km, priority,
               target_finish_h, notes, strava_activity_id
        FROM race_events
        ORDER BY race_date
    """).fetchall()
    cols = ["id", "name", "race_date", "distance_km", "priority",
            "target_finish_h", "notes", "strava_activity_id"]
    return [dict(zip(cols, r)) for r in rows]
