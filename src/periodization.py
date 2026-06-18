import sys
from pathlib import Path
from datetime import date, timedelta
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent))

from db import (
    upsert_training_plan_week, upsert_daily_session,
    upsert_race_analysis, stamp_race_activity,
)

COMRADES_DATE = date(2027, 6, 13)
RACE_DISTANCE_KM = 90.0
TERRAIN_FACTOR = 1.04  # +4% for Comrades Down Run

# km targets
_BASE_START_KM = 55.0   # starting point if no recent data
_PEAK_KM = 110.0


def _monday(d: date) -> date:
    wd = d.weekday()
    if wd == 0:
        return d
    return d + timedelta(days=(7 - wd))


def _estimate_current_fitness(conn) -> float:
    row = conn.execute("""
        SELECT AVG(wkly)
        FROM (
            SELECT SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS wkly
            FROM activities
            WHERE start_date_local::DATE >= CURRENT_DATE - INTERVAL '28 days'
            GROUP BY DATE_TRUNC('week', start_date_local::DATE)
        )
    """).fetchone()
    return float(row[0]) if row and row[0] else _BASE_START_KM


def _assign_block_types(
    weeks: list[date],
    comrades_idx: int,
    race_windows: dict,
) -> list[str]:
    n = len(weeks)
    # First 6 non-race weeks = base, then 4-week build cycles
    base_cap = 6
    types = []
    build_week_count = 0

    for i, w in enumerate(weeks):
        if w in race_windows:
            types.append(race_windows[w][0])
            continue
        offset = i - comrades_idx
        if offset >= 0:
            types.append("race")
        elif offset >= -3:
            types.append("taper")
        elif offset >= -9:
            types.append("peak")
        else:
            # Count non-race-window weeks from the start for base/build assignment
            non_race_so_far = sum(
                1 for j in range(i) if weeks[j] not in race_windows
            )
            if non_race_so_far < base_cap:
                types.append("base")
            else:
                build_pos = non_race_so_far - base_cap
                types.append("deload" if build_pos % 4 == 3 else "build")
    return types


def _target_km(block_type: str, week_idx: int, comrades_idx: int, current_km: float) -> float:
    offset = week_idx - comrades_idx
    if block_type == "taper":
        factors = {-1: 0.60, -2: 0.75, -3: 0.85}
        return _PEAK_KM * factors.get(offset, 0.85)
    if block_type == "peak":
        return _PEAK_KM
    if block_type == "base":
        # Weeks since start, gentle progression up to 1.5× start km
        progression = 1.05 ** week_idx
        return min(current_km * progression, current_km * 1.5)
    if block_type in ("build", "deload"):
        # Linear ramp from current_km to _PEAK_KM across build phase
        build_start = 6  # base weeks
        peak_start = comrades_idx - 9
        span = max(1, peak_start - build_start)
        progress = max(0.0, min(1.0, (week_idx - build_start) / span))
        base = current_km + (_PEAK_KM - current_km) * progress
        return base * (0.70 if block_type == "deload" else 1.0)
    return current_km  # recovery / race_taper handled by race window factor


def build_plan(conn, comrades_date: date, race_events: list[dict]) -> None:
    today = _monday(date.today())
    comrades_monday = _monday(comrades_date)

    weeks: list[date] = []
    w = today
    while w <= comrades_monday:
        weeks.append(w)
        w += timedelta(weeks=1)

    comrades_idx = len(weeks) - 1
    current_km = _estimate_current_fitness(conn)

    # Build race window lookup
    race_windows: dict = {}
    for race in sorted(race_events, key=lambda r: (
        r["race_date"] if isinstance(r["race_date"], date)
        else date.fromisoformat(str(r["race_date"]))
    )):
        rd = race["race_date"]
        if isinstance(rd, str):
            rd = date.fromisoformat(rd)
        race_mon = _monday(rd)
        priority = race.get("priority", "B")
        taper_factor = 0.75 if priority == "A" else 0.85
        recovery_factor = 0.65 if priority == "A" else 0.75
        pre = race_mon - timedelta(weeks=1)
        post = race_mon + timedelta(weeks=1)
        if pre not in race_windows:
            race_windows[pre] = ("race_taper", race, taper_factor)
        if race_mon not in race_windows:
            race_windows[race_mon] = ("race", race, 1.0)
        if post not in race_windows:
            race_windows[post] = ("recovery", race, recovery_factor)

    block_types = _assign_block_types(weeks, comrades_idx, race_windows)

    conn.execute("BEGIN")
    try:
        conn.execute("DELETE FROM training_plan_daily")
        conn.execute("DELETE FROM training_plan")
        conn.execute("DELETE FROM training_blocks")

        for week_num, (monday, block_type) in enumerate(zip(weeks, block_types), start=1):
            sunday = monday + timedelta(days=6)

            base_km = _target_km(block_type, week_num - 1, comrades_idx, current_km)
            if monday in race_windows:
                _, _, factor = race_windows[monday]
                weekly_km = base_km * factor if block_type not in ("race", "recovery") else base_km * factor
            else:
                weekly_km = base_km

            phase_labels = {
                "base": "Base", "build": "Build", "peak": "Peak",
                "taper": "Taper", "race_taper": "Race Prep",
                "recovery": "Recovery", "deload": "Deload", "race": "Race Week",
            }
            is_deload = block_type in ("deload", "recovery")

            # Long run = 30% of weekly km, capped at 35%
            long_run_km = min(weekly_km * 0.30, weekly_km * 0.35)

            upsert_training_plan_week(conn, {
                "week_number": week_num,
                "week_start_date": monday.isoformat(),
                "phase": phase_labels.get(block_type, block_type.title()),
                "planned_distance_km": round(weekly_km, 1),
                "planned_long_run_km": round(long_run_km, 1),
                "planned_sessions": _session_count(block_type),
                "is_deload": is_deload,
                "notes": None,
            })

            _write_daily_sessions(conn, monday, week_num, block_type, weekly_km)

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def _session_count(block_type: str) -> int:
    return {"base": 5, "build": 5, "peak": 6, "taper": 5,
            "race_taper": 4, "recovery": 4, "deload": 4, "race": 3}.get(block_type, 5)


def _write_daily_sessions(conn, monday: date, week_num: int, block_type: str, weekly_km: float) -> None:
    # Placeholder — filled in Task 4
    pass


# --- Race detection & analysis (filled in Task 5) ---
def detect_and_analyse_race(conn, activity: dict) -> dict | None:
    return None


def update_comrades_projection(conn, race_event_id: int, race_result: dict) -> float:
    return 0.0
