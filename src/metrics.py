import duckdb
import pandas as pd
from typing import Optional

RACE_DISTANCE_KM = 90.0


def weekly_volume(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        SELECT
            DATE_TRUNC('week', start_date_local::DATE) AS week_start,
            SUM(CASE WHEN category = 'running' THEN distance_km ELSE 0 END) AS run_distance_km,
            SUM(CASE WHEN category = 'running' THEN elevation_gain_m ELSE 0 END) AS elevation_gain_m,
            MAX(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS longest_run_km,
            SUM(CASE WHEN category = 'running' THEN moving_time_min ELSE 0 END) AS run_time_min,
            SUM(moving_time_min) AS total_time_min,
            COUNT(*) AS session_count,
            7 - COUNT(DISTINCT start_date_local::DATE) AS rest_day_count
        FROM activities
        GROUP BY 1
        ORDER BY 1 DESC
    """).df()


def weekly_category_load(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        SELECT
            DATE_TRUNC('week', start_date_local::DATE) AS week_start,
            SUM(CASE WHEN category = 'running'    THEN load_score ELSE 0 END) AS running_load,
            SUM(CASE WHEN category = 'volleyball' THEN load_score ELSE 0 END) AS volleyball_load,
            SUM(CASE WHEN category = 'cricket'    THEN load_score ELSE 0 END) AS cricket_load,
            SUM(CASE WHEN category = 'gym'        THEN load_score ELSE 0 END) AS gym_load,
            SUM(load_score) AS total_load
        FROM activities
        GROUP BY 1
        ORDER BY 1 DESC
    """).df()


def recent_activities(conn: duckdb.DuckDBPyConnection, n: int = 15) -> pd.DataFrame:
    return conn.execute(f"""
        SELECT
            start_date_local::DATE AS date,
            name,
            category,
            sport_type,
            ROUND(distance_km, 1) AS distance_km,
            ROUND(moving_time_min, 0) AS duration_min,
            ROUND(elevation_gain_m, 0) AS elevation_m,
            average_heartrate,
            ROUND(load_score, 0) AS load_score
        FROM activities
        ORDER BY start_date_local DESC
        LIMIT {n}
    """).df()


def acwr_history(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        WITH daily AS (
            SELECT
                start_date_local::DATE AS day,
                SUM(load_score) AS daily_load
            FROM activities
            GROUP BY 1
        ),
        rolling AS (
            SELECT
                day,
                daily_load,
                SUM(daily_load) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS load_7d,
                SUM(daily_load) OVER (ORDER BY day ROWS BETWEEN 27 PRECEDING AND CURRENT ROW) AS load_28d
            FROM daily
        )
        SELECT
            day,
            load_7d,
            load_28d,
            CASE WHEN load_28d > 0
                THEN ROUND(load_7d / (load_28d / 4.0), 3)
                ELSE NULL
            END AS acwr
        FROM rolling
        ORDER BY day DESC
    """).df()


def weekly_ramp_rate(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        WITH weekly AS (
            SELECT
                DATE_TRUNC('week', start_date_local::DATE) AS week_start,
                SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS run_distance_km
            FROM activities
            GROUP BY 1
        )
        SELECT
            week_start,
            run_distance_km,
            LAG(run_distance_km) OVER (ORDER BY week_start) AS prev_week_km,
            CASE
                WHEN LAG(run_distance_km) OVER (ORDER BY week_start) > 0
                THEN ROUND(
                    (run_distance_km - LAG(run_distance_km) OVER (ORDER BY week_start)) /
                    LAG(run_distance_km) OVER (ORDER BY week_start) * 100, 1
                )
                ELSE NULL
            END AS ramp_pct
        FROM weekly
        ORDER BY week_start DESC
    """).df()


def weekly_monotony(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        WITH daily AS (
            SELECT
                DATE_TRUNC('week', start_date_local::DATE) AS week_start,
                start_date_local::DATE AS day,
                SUM(load_score) AS daily_load
            FROM activities
            GROUP BY 1, 2
        )
        SELECT
            week_start,
            AVG(daily_load) AS mean_daily_load,
            STDDEV(daily_load) AS stddev_daily_load,
            CASE
                WHEN STDDEV(daily_load) > 0
                THEN ROUND(AVG(daily_load) / STDDEV(daily_load), 3)
                ELSE NULL
            END AS monotony,
            SUM(daily_load) AS weekly_total_load,
            CASE
                WHEN STDDEV(daily_load) > 0
                THEN ROUND(AVG(daily_load) / STDDEV(daily_load) * SUM(daily_load), 1)
                ELSE NULL
            END AS strain
        FROM daily
        GROUP BY 1
        ORDER BY 1 DESC
    """).df()


def long_run_pct(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        WITH weekly AS (
            SELECT
                DATE_TRUNC('week', start_date_local::DATE) AS week_start,
                SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS run_distance_km,
                MAX(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS longest_run_km
            FROM activities
            GROUP BY 1
        )
        SELECT
            week_start,
            run_distance_km,
            longest_run_km,
            CASE
                WHEN run_distance_km > 0
                THEN ROUND(longest_run_km / run_distance_km * 100, 1)
                ELSE NULL
            END AS long_run_pct
        FROM weekly
        ORDER BY week_start DESC
    """).df()


def plan_adherence(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        WITH weekly_actual AS (
            SELECT
                DATE_TRUNC('week', start_date_local::DATE) AS week_start,
                SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS actual_distance_km
            FROM activities
            GROUP BY 1
        )
        SELECT
            tp.week_start_date,
            tp.week_number,
            tp.phase,
            tp.planned_distance_km,
            tp.planned_long_run_km,
            tp.is_deload,
            COALESCE(wa.actual_distance_km, 0) AS actual_distance_km,
            CASE
                WHEN tp.planned_distance_km > 0
                THEN ROUND(COALESCE(wa.actual_distance_km, 0) / tp.planned_distance_km * 100, 1)
                ELSE NULL
            END AS adherence_pct
        FROM training_plan tp
        LEFT JOIN weekly_actual wa ON tp.week_start_date::DATE = wa.week_start::DATE
        ORDER BY tp.week_start_date DESC
    """).df()


def current_week_stats(conn: duckdb.DuckDBPyConnection) -> dict:
    row = conn.execute("""
        SELECT
            SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS run_km,
            COUNT(*) AS sessions
        FROM activities
        WHERE DATE_TRUNC('week', start_date_local::DATE) = DATE_TRUNC('week', current_date)
    """).fetchone()

    plan_row = conn.execute("""
        SELECT planned_distance_km, phase
        FROM training_plan
        WHERE week_start_date = DATE_TRUNC('week', current_date)::DATE
        LIMIT 1
    """).fetchone()

    run_km = row[0] or 0.0
    planned_km = plan_row[0] if plan_row else 0.0
    phase = plan_row[1] if plan_row else "No plan loaded"
    adherence_pct = (run_km / planned_km * 100) if planned_km > 0 else 0.0

    return {
        "run_distance_km": run_km,
        "planned_km": planned_km,
        "phase": phase,
        "adherence_pct": adherence_pct,
        "session_count": row[1] or 0,
    }


def zone2_pace_trend(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        SELECT
            a.start_date_local::DATE AS activity_date,
            a.name,
            a.distance_km,
            sd.pct_time_z2,
            a.average_heartrate,
            CASE WHEN a.average_speed_kmh > 0
                THEN ROUND(60.0 / a.average_speed_kmh, 2)
                ELSE NULL
            END AS pace_min_per_km,
            sd.grade_adjusted_pace,
            sd.decoupling_pct,
            sd.cadence_avg
        FROM activities a
        JOIN activity_streams_derived sd ON a.id = sd.activity_id
        WHERE a.category = 'running'
          AND sd.pct_time_z2 >= 50
          AND a.distance_km >= 10
        ORDER BY a.start_date_local
    """).df()


def back_to_back_runs(conn: duckdb.DuckDBPyConnection, min_km: float = 15.0) -> pd.DataFrame:
    return conn.execute("""
        WITH runs AS (
            SELECT
                start_date_local::DATE AS run_date,
                distance_km
            FROM activities
            WHERE category = 'running'
              AND distance_km >= ?
        )
        SELECT
            r1.run_date AS day1,
            r2.run_date AS day2,
            r1.distance_km AS day1_km,
            r2.distance_km AS day2_km,
            r1.distance_km + r2.distance_km AS combined_km
        FROM runs r1
        JOIN runs r2 ON r2.run_date = r1.run_date + INTERVAL 1 DAY
        ORDER BY r1.run_date DESC
    """, [min_km]).df()


def comrades_milestones(
    conn: duckdb.DuckDBPyConnection,
    race_distance_km: float = RACE_DISTANCE_KM,
    race_descent_m: float = 1800.0,
) -> dict:
    longest_run = conn.execute(
        "SELECT COALESCE(MAX(distance_km), 0) FROM activities WHERE category = 'running'"
    ).fetchone()[0]

    total_descent = conn.execute("""
        SELECT COALESCE(SUM(sd.elevation_loss_m), 0)
        FROM activities a
        JOIN activity_streams_derived sd ON a.id = sd.activity_id
        WHERE a.category = 'running'
    """).fetchone()[0]

    max_b2b = conn.execute("""
        WITH runs AS (
            SELECT start_date_local::DATE AS run_date, distance_km
            FROM activities WHERE category = 'running'
        )
        SELECT COALESCE(MAX(r1.distance_km + r2.distance_km), 0)
        FROM runs r1
        JOIN runs r2 ON r2.run_date = r1.run_date + INTERVAL 1 DAY
    """).fetchone()[0]

    recent_pace_df = conn.execute("""
        SELECT 60.0 / average_speed_kmh AS pace_min_km
        FROM activities
        WHERE category = 'running'
          AND distance_km >= 25
          AND average_speed_kmh > 0
        ORDER BY start_date_local DESC
        LIMIT 5
    """).df()

    avg_pace = float(recent_pace_df["pace_min_km"].mean()) if len(recent_pace_df) > 0 else None
    projected_min = avg_pace * race_distance_km if avg_pace else None

    return {
        "longest_run_km": float(longest_run),
        "longest_run_pct_race": round(float(longest_run) / race_distance_km * 100, 1),
        "total_descent_m": float(total_descent),
        "race_descent_m": race_descent_m,
        "descent_pct_practiced": round(float(total_descent) / race_descent_m * 100, 1) if total_descent else 0.0,
        "max_b2b_km": float(max_b2b),
        "projected_finish_min": projected_min,
        "projected_finish_h": round(projected_min / 60, 2) if projected_min else None,
        "cutoff_h": 12.0,
    }
