import duckdb
import pandas as pd
from typing import Optional

RACE_DISTANCE_KM = 90.0
TRAINING_START: str = "2026-01-01"
TRAINING_END: Optional[str] = None


def _date_filter(alias: str = "") -> str:
    col = f"{alias}.start_date_local" if alias else "start_date_local"
    parts = [f"{col}::DATE >= '{TRAINING_START}'"]
    if TRAINING_END:
        parts.append(f"{col}::DATE <= '{TRAINING_END}'")
    return " AND ".join(parts)


def weekly_volume(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute(f"""
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
        WHERE {_date_filter()}
        GROUP BY 1
        ORDER BY 1 DESC
    """).df()


def weekly_category_load(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute(f"""
        SELECT
            DATE_TRUNC('week', start_date_local::DATE) AS week_start,
            SUM(CASE WHEN category = 'running'    THEN load_score ELSE 0 END) AS running_load,
            SUM(CASE WHEN category = 'volleyball' THEN load_score ELSE 0 END) AS volleyball_load,
            SUM(CASE WHEN category = 'cricket'    THEN load_score ELSE 0 END) AS cricket_load,
            SUM(CASE WHEN category = 'gym'        THEN load_score ELSE 0 END) AS gym_load,
            SUM(load_score) AS total_load
        FROM activities
        WHERE {_date_filter()}
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
        WHERE {_date_filter()}
        ORDER BY start_date_local DESC
        LIMIT {n}
    """).df()


def acwr_history(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute(f"""
        WITH daily AS (
            SELECT
                start_date_local::DATE AS day,
                SUM(load_score) AS daily_load
            FROM activities
            WHERE {_date_filter()}
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
    return conn.execute(f"""
        WITH weekly AS (
            SELECT
                DATE_TRUNC('week', start_date_local::DATE) AS week_start,
                SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS run_distance_km
            FROM activities
            WHERE {_date_filter()}
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
    return conn.execute(f"""
        WITH daily AS (
            SELECT
                DATE_TRUNC('week', start_date_local::DATE) AS week_start,
                start_date_local::DATE AS day,
                SUM(load_score) AS daily_load
            FROM activities
            WHERE {_date_filter()}
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
    return conn.execute(f"""
        WITH weekly AS (
            SELECT
                DATE_TRUNC('week', start_date_local::DATE) AS week_start,
                SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS run_distance_km,
                MAX(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS longest_run_km
            FROM activities
            WHERE {_date_filter()}
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


def weekly_elevation(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute(f"""
        SELECT
            DATE_TRUNC('week', start_date_local::DATE) AS week_start,
            SUM(CASE WHEN category = 'running' THEN COALESCE(elevation_gain_m, 0) ELSE 0 END) AS weekly_gain_m
        FROM activities
        WHERE {_date_filter()}
        GROUP BY 1
        ORDER BY 1
    """).df()


def weekly_zone_time(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute(f"""
        SELECT
            DATE_TRUNC('week', a.start_date_local::DATE) AS week_start,
            ROUND(SUM(a.moving_time_min * sd.pct_time_z1 / 100.0), 1) AS z1_min,
            ROUND(SUM(a.moving_time_min * sd.pct_time_z2 / 100.0), 1) AS z2_min,
            ROUND(SUM(a.moving_time_min * sd.pct_time_z3 / 100.0), 1) AS z3_min,
            ROUND(SUM(a.moving_time_min * sd.pct_time_z4 / 100.0), 1) AS z4_min,
            ROUND(SUM(a.moving_time_min * sd.pct_time_z5 / 100.0), 1) AS z5_min
        FROM activities a
        JOIN activity_streams_derived sd ON a.id = sd.activity_id
        WHERE a.category = 'running'
          AND {_date_filter('a')}
        GROUP BY 1
        ORDER BY 1
    """).df()


def cadence_trend(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute(f"""
        SELECT
            a.start_date_local::DATE AS activity_date,
            a.name,
            ROUND(a.distance_km, 1) AS distance_km,
            sd.cadence_avg
        FROM activities a
        JOIN activity_streams_derived sd ON a.id = sd.activity_id
        WHERE a.category = 'running'
          AND sd.cadence_avg IS NOT NULL
          AND {_date_filter('a')}
        ORDER BY a.start_date_local
    """).df()


def long_run_history(conn: duckdb.DuckDBPyConnection, min_km: float = 20.0) -> pd.DataFrame:
    return conn.execute(f"""
        SELECT
            a.start_date_local::DATE AS activity_date,
            a.name,
            ROUND(a.distance_km, 1) AS distance_km,
            ROUND(a.moving_time_min, 0) AS duration_min,
            ROUND(a.elevation_gain_m, 0) AS elevation_gain_m,
            ROUND(a.average_heartrate, 0) AS avg_hr,
            CASE WHEN a.average_speed_kmh > 0
                THEN ROUND(60.0 / a.average_speed_kmh, 2)
                ELSE NULL
            END AS pace_min_km,
            sd.decoupling_pct,
            sd.pct_time_z2
        FROM activities a
        LEFT JOIN activity_streams_derived sd ON a.id = sd.activity_id
        WHERE a.category = 'running'
          AND a.distance_km >= {min_km}
          AND {_date_filter('a')}
        ORDER BY a.start_date_local DESC
    """).df()


def monthly_volume(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute(f"""
        SELECT
            DATE_TRUNC('month', start_date_local::DATE) AS month_start,
            SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS run_distance_km,
            ROUND(SUM(CASE WHEN category = 'running' THEN COALESCE(moving_time_min, 0) ELSE 0 END) / 60.0, 1) AS run_time_h,
            SUM(CASE WHEN category = 'running' THEN COALESCE(elevation_gain_m, 0) ELSE 0 END) AS elevation_gain_m,
            COUNT(CASE WHEN category = 'running' THEN 1 END) AS run_count
        FROM activities
        WHERE {_date_filter()}
        GROUP BY 1
        ORDER BY 1
    """).df()


def plan_adherence(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute(f"""
        WITH weekly_actual AS (
            SELECT
                DATE_TRUNC('week', start_date_local::DATE) AS week_start,
                SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS actual_distance_km
            FROM activities
            WHERE {_date_filter()}
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
    return conn.execute(f"""
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
          AND a.distance_km >= 5
          AND {_date_filter('a')}
        ORDER BY a.start_date_local
    """).df()


def back_to_back_runs(conn: duckdb.DuckDBPyConnection, min_km: float = 15.0) -> pd.DataFrame:
    return conn.execute(f"""
        WITH runs AS (
            SELECT
                start_date_local::DATE AS run_date,
                distance_km
            FROM activities
            WHERE category = 'running'
              AND distance_km >= {min_km}
              AND {_date_filter()}
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
    """).df()


def comrades_milestones(
    conn: duckdb.DuckDBPyConnection,
    race_distance_km: float = RACE_DISTANCE_KM,
    race_descent_m: float = 1800.0,
) -> dict:
    longest_run = conn.execute(f"""
        SELECT COALESCE(MAX(distance_km), 0) FROM activities
        WHERE category = 'running' AND {_date_filter()}
    """).fetchone()[0]

    total_descent = conn.execute(f"""
        SELECT COALESCE(SUM(sd.elevation_loss_m), 0)
        FROM activities a
        JOIN activity_streams_derived sd ON a.id = sd.activity_id
        WHERE a.category = 'running' AND {_date_filter('a')}
    """).fetchone()[0]

    total_gain = conn.execute(f"""
        SELECT COALESCE(SUM(elevation_gain_m), 0) FROM activities
        WHERE category = 'running' AND {_date_filter()}
    """).fetchone()[0]

    run_counts = conn.execute(f"""
        SELECT
            COUNT(CASE WHEN distance_km >= 20 THEN 1 END) AS runs_20plus,
            COUNT(CASE WHEN distance_km >= 30 THEN 1 END) AS runs_30plus,
            COUNT(CASE WHEN distance_km >= 40 THEN 1 END) AS runs_40plus
        FROM activities
        WHERE category = 'running' AND {_date_filter()}
    """).fetchone()

    max_b2b = conn.execute(f"""
        WITH runs AS (
            SELECT start_date_local::DATE AS run_date, distance_km
            FROM activities
            WHERE category = 'running' AND {_date_filter()}
        )
        SELECT COALESCE(MAX(r1.distance_km + r2.distance_km), 0)
        FROM runs r1
        JOIN runs r2 ON r2.run_date = r1.run_date + INTERVAL 1 DAY
    """).fetchone()[0]

    recent_pace_df = conn.execute(f"""
        SELECT 60.0 / average_speed_kmh AS pace_min_km
        FROM activities
        WHERE category = 'running'
          AND distance_km >= 25
          AND average_speed_kmh > 0
          AND {_date_filter()}
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
        "total_gain_m": float(total_gain),
        "runs_20plus": run_counts[0] or 0,
        "runs_30plus": run_counts[1] or 0,
        "runs_40plus": run_counts[2] or 0,
        "max_b2b_km": float(max_b2b),
        "projected_finish_min": projected_min,
        "projected_finish_h": round(projected_min / 60, 2) if projected_min else None,
        "cutoff_h": 12.0,
    }


def daily_plan_for_week(conn: duckdb.DuckDBPyConnection, week_number: int) -> pd.DataFrame:
    return conn.execute("""
        SELECT
            planned_date,
            day_of_week,
            session_type,
            ROUND(planned_distance_km, 1) AS planned_km,
            intensity,
            is_quality,
            completed,
            ROUND(completed_distance_km, 1) AS actual_km,
            completed_activity_id,
            description
        FROM training_plan_daily
        WHERE week_number = ?
        ORDER BY planned_date
    """, [week_number]).df()


def weekly_completion_summary(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        SELECT
            tp.week_number,
            tp.week_start_date,
            tp.phase,
            tp.planned_distance_km,
            tp.is_deload,
            COUNT(d.planned_date)                                                     AS total_days,
            SUM(CASE WHEN d.completed THEN 1 ELSE 0 END)                             AS days_done,
            SUM(CASE WHEN d.session_type IN ('easy_run','quality_run','long_run','hills','race')
                     THEN 1 ELSE 0 END)                                               AS run_days,
            SUM(CASE WHEN d.session_type IN ('easy_run','quality_run','long_run','hills','race')
                          AND d.completed THEN 1 ELSE 0 END)                          AS run_days_done,
            ROUND(SUM(CASE WHEN d.completed THEN 1 ELSE 0 END)::DOUBLE
                  / NULLIF(COUNT(d.planned_date), 0) * 100, 0)                       AS completion_pct
        FROM training_plan tp
        LEFT JOIN training_plan_daily d ON d.week_number = tp.week_number
        GROUP BY tp.week_number, tp.week_start_date, tp.phase,
                 tp.planned_distance_km, tp.is_deload
        ORDER BY tp.week_number
    """).df()


def ctl_atl_tsb_history(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    daily = conn.execute("""
        WITH date_spine AS (
            SELECT UNNEST(generate_series(
                (SELECT MIN(start_date_local::DATE) FROM activities),
                CURRENT_DATE,
                INTERVAL '1 day'
            ))::DATE AS day
        ),
        daily_load AS (
            SELECT start_date_local::DATE AS day, SUM(load_score) AS load
            FROM activities GROUP BY 1
        )
        SELECT d.day, COALESCE(l.load, 0.0) AS load
        FROM date_spine d
        LEFT JOIN daily_load l ON d.day = l.day
        ORDER BY d.day
    """).df()

    if daily.empty:
        return daily

    ctl, atl = 0.0, 0.0
    rows = []
    for _, row in daily.iterrows():
        tsb = ctl - atl
        ctl = ctl + (float(row["load"]) - ctl) / 42.0
        atl = atl + (float(row["load"]) - atl) / 7.0
        rows.append({"day": row["day"], "load": row["load"],
                     "ctl": round(ctl, 2), "atl": round(atl, 2), "tsb": round(tsb, 2)})

    return pd.DataFrame(rows)


def long_run_quality_scores(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        SELECT
            a.start_date_local::DATE AS activity_date,
            a.name,
            ROUND(a.distance_km, 1) AS distance_km,
            ROUND(COALESCE(s.pct_time_z1 + s.pct_time_z2, 0), 1) AS z2_compliance_pct,
            ROUND(COALESCE(s.decoupling_pct, 0), 2) AS decoupling_pct,
            ROUND(GREATEST(0, LEAST(100,
                -- Z2 compliance component: maps 60–100% → 0–100
                GREATEST(0, (COALESCE(s.pct_time_z1 + s.pct_time_z2, 0) - 60.0) / 40.0 * 100.0) * 0.5
                +
                -- Decoupling component: maps 0% decoupling → 100, 5%+ → 0
                GREATEST(0, (5.0 - LEAST(5.0, ABS(COALESCE(s.decoupling_pct, 5.0)))) / 5.0 * 100.0) * 0.5
            )), 1) AS quality_score
        FROM activities a
        JOIN activity_streams_derived s ON a.id = s.activity_id
        WHERE a.category = 'running'
          AND a.distance_km >= 20
        ORDER BY a.start_date_local DESC
    """).df()


COMRADES_CHECKPOINTS = [
    ("Pietermaritzburg",  0.0,  750),
    ("Camperdown",        24.0, 700),
    ("Cato Ridge",        36.0, 820),
    ("Drummond",          46.0, 660),
    ("Botha's Hill",      60.0, 560),
    ("Hillcrest",         68.0, 450),
    ("Pinetown",          76.0, 180),
    ("45th Cutting",      84.0,  60),
    ("Durban",            90.0,   5),
]


def comrades_projected_splits(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    proj_row = conn.execute(
        "SELECT comrades_projection_h FROM race_analysis ORDER BY computed_at DESC LIMIT 1"
    ).fetchone()

    if not proj_row:
        z2_row = conn.execute("""
            SELECT AVG(moving_time_min / NULLIF(distance_km, 0))
            FROM activities
            WHERE category = 'running' AND distance_km >= 10
              AND start_date_local >= CURRENT_DATE - INTERVAL '90 days'
        """).fetchone()
        if not z2_row or not z2_row[0]:
            return pd.DataFrame()
        total_h = float(z2_row[0]) * 90.0 / 60.0 * 1.04
    else:
        total_h = float(proj_row[0])

    total_min = total_h * 60.0
    rows = []
    raw_cumulative = 0.0
    seg_mins = []

    for i, (name, km, elev) in enumerate(COMRADES_CHECKPOINTS):
        if i == 0:
            rows.append({"checkpoint": name, "km": km,
                         "cumulative_time": "0:00", "cumulative_min": 0.0})
            seg_mins.append(0.0)
            continue
        prev_km, prev_elev = COMRADES_CHECKPOINTS[i - 1][1], COMRADES_CHECKPOINTS[i - 1][2]
        seg_km = km - prev_km
        grade = (elev - prev_elev) / (seg_km * 1000.0)
        adj = 1.0 + grade * (2.0 if grade > 0 else -1.5)
        seg_min = total_min * (seg_km / 90.0) * adj
        raw_cumulative += seg_min
        seg_mins.append(seg_min)
        rows.append({"checkpoint": name, "km": km,
                     "cumulative_min": round(raw_cumulative, 1), "cumulative_time": ""})

    # Normalize so final checkpoint == total_min
    scale = total_min / raw_cumulative if raw_cumulative else 1.0
    cum = 0.0
    for i, r in enumerate(rows):
        if i == 0:
            continue
        cum += seg_mins[i] * scale
        r["cumulative_min"] = round(cum, 1)
        h, m = int(cum // 60), int(cum % 60)
        r["cumulative_time"] = f"{h}:{m:02d}"

    return pd.DataFrame(rows)


def shoe_mileage(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return conn.execute("""
        SELECT
            g.id,
            g.name,
            g.type,
            g.retire_km_threshold,
            g.is_retired,
            ROUND(COALESCE(SUM(a.distance_km), 0), 1) AS total_km,
            ROUND(g.retire_km_threshold - COALESCE(SUM(a.distance_km), 0), 1) AS km_remaining
        FROM gear g
        LEFT JOIN activities a
            ON a.gear_id = g.id AND a.category = 'running'
        WHERE NOT g.is_retired
        GROUP BY g.id, g.name, g.type, g.retire_km_threshold, g.is_retired
        ORDER BY total_km DESC
    """).df()
