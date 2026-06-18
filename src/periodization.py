import sys
from pathlib import Path
from datetime import date, timedelta

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
    """Return the Monday of or after d (ceil semantics — rounds up, not down)."""
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

    # Reset quality rotation for reproducible plan generation
    global _quality_idx
    _quality_idx = 0

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
                weekly_km = base_km * factor
            else:
                weekly_km = base_km

            phase_labels = {
                "base": "Base", "build": "Build", "peak": "Peak",
                "taper": "Taper", "race_taper": "Race Prep",
                "recovery": "Recovery", "deload": "Deload", "race": "Race Week",
            }
            is_deload = block_type in ("deload", "recovery")

            # Long run = 30% of weekly km, capped at 35%
            long_run_km = weekly_km * 0.30

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


_QUALITY_ROTATION = ["hills", "tempo", "intervals"]

_DESCRIPTIONS = {
    "rest":        {"rest":     "Full rest. Walk only. Prioritise sleep and nutrition."},
    "sc":          {"rest":     "Strength & conditioning: glutes, hip flexors, single-leg work. 45–60 min."},
    "easy_run":    {
        "easy":     "RPE 4–5. Conversational pace. Focus on time on feet.",
        "moderate": "RPE 5–6. Comfortably hard. Last 15 min can push slightly.",
    },
    "quality_run": {
        "hard":     "Tempo: 10 min warm-up, 30 min at half-marathon effort (RPE 7), 10 min cool-down.",
    },
    "hills":       {"hard":     "Hill repeats: 8 × 90s hard uphill, jog down recovery. Builds Comrades climbing strength."},
    "long_run":    {
        "easy":     "RPE 4–5. Pure recovery long run. Heart rate stays in Z1–Z2 throughout.",
        "moderate": "RPE 5–6. Steady aerobic effort. Practise race nutrition every 30 min.",
        "hard":     "RPE 6–7. Peak-block long run — start easy, finish at marathon effort.",
    },
    "race":        {"race":     "Race day. Execute your pacing plan. Treat as a hard training stimulus."},
}

# Mon=0 … Sun=6 session templates per block type
# (session_type, intensity, km_fraction_of_weekly)
_TEMPLATES: dict[str, list[tuple]] = {
    "base":      [("rest","rest",0), ("easy_run","easy",0.12), ("easy_run","easy",0.12),
                  ("easy_run","moderate",0.14), ("sc","rest",0), ("easy_run","easy",0.12), ("long_run","moderate",0.30)],
    "build":     [("rest","rest",0), ("easy_run","easy",0.10), ("quality_run","hard",0.13),
                  ("easy_run","easy",0.12), ("sc","rest",0), ("easy_run","easy",0.10), ("long_run","moderate",0.30)],
    "peak":      [("easy_run","easy",0.10), ("quality_run","hard",0.13), ("easy_run","easy",0.10),
                  ("hills","hard",0.12), ("rest","rest",0), ("easy_run","easy",0.10), ("long_run","hard",0.30)],
    "taper":     [("rest","rest",0), ("easy_run","easy",0.12), ("quality_run","hard",0.13),
                  ("easy_run","easy",0.12), ("rest","rest",0), ("easy_run","easy",0.10), ("long_run","moderate",0.25)],
    "race_taper_A": [("rest","rest",0), ("easy_run","easy",0.15), ("rest","rest",0),
                     ("easy_run","easy",0.12), ("rest","rest",0), ("easy_run","easy",0.10), ("easy_run","easy",0.08)],
    "race_taper_B": [("rest","rest",0), ("easy_run","easy",0.13), ("quality_run","hard",0.13),
                     ("easy_run","easy",0.12), ("rest","rest",0), ("easy_run","easy",0.10), ("easy_run","easy",0.08)],
    "recovery":  [("rest","rest",0), ("easy_run","easy",0.14), ("easy_run","easy",0.14),
                  ("rest","rest",0), ("rest","rest",0), ("easy_run","easy",0.14), ("long_run","easy",0.22)],
    "deload":    [("rest","rest",0), ("easy_run","easy",0.13), ("easy_run","easy",0.13),
                  ("rest","rest",0), ("sc","rest",0), ("easy_run","easy",0.13), ("long_run","easy",0.25)],
    "race":      [("easy_run","easy",0.10), ("easy_run","easy",0.10), ("rest","rest",0),
                  ("easy_run","easy",0.08), ("rest","rest",0), ("easy_run","easy",0.08), ("race","race",0)],
}

_quality_idx = 0  # module-level rotation counter (reset at start of build_plan)


def _write_daily_sessions(conn, monday: date, week_num: int, block_type: str, weekly_km: float) -> None:
    global _quality_idx
    DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    # Pick template — race_taper needs priority context; use generic race_taper_B as fallback
    template_key = block_type
    if block_type == "race_taper":
        template_key = "race_taper_B"  # default; priority passed separately if needed

    template = _TEMPLATES.get(template_key, _TEMPLATES["base"])

    for day_offset, (stype, intensity, km_frac) in enumerate(template):
        planned_date = monday + timedelta(days=day_offset)

        # Swap quality_run for hills on rotation
        actual_type = stype
        if stype == "quality_run":
            rotation_type = _QUALITY_ROTATION[_quality_idx % len(_QUALITY_ROTATION)]
            if rotation_type == "hills":
                actual_type = "hills"
                intensity = "hard"
            elif rotation_type == "tempo":
                actual_type = "quality_run"
            else:  # intervals
                actual_type = "quality_run"
            _quality_idx += 1

        planned_km = round(weekly_km * km_frac, 1) if km_frac > 0 else None

        # Long run guard: cap at 35% of weekly_km
        if actual_type == "long_run" and planned_km and weekly_km > 0:
            planned_km = min(planned_km, round(weekly_km * 0.35, 1))

        desc_map = _DESCRIPTIONS.get(actual_type, {})
        description = desc_map.get(intensity, desc_map.get(list(desc_map.keys())[0], "—") if desc_map else "—")

        upsert_daily_session(conn, {
            "planned_date": planned_date.isoformat(),
            "week_number": week_num,
            "day_of_week": DAYS[day_offset],
            "session_type": actual_type,
            "planned_distance_km": planned_km,
            "intensity": intensity,
            "description": description,
            "is_quality": actual_type in ("quality_run", "hills"),
        })


# --- Race detection & analysis ---
def detect_and_analyse_race(conn, activity: dict) -> dict | None:
    if activity.get("category") != "running":
        return None
    if not activity.get("distance_km"):
        return None

    act_date = activity["start_date_local"][:10]  # "YYYY-MM-DD"
    act_km = float(activity["distance_km"])

    races = conn.execute("""
        SELECT id, race_date::TEXT, distance_km
        FROM race_events
        WHERE strava_activity_id IS NULL
          AND ABS(CAST(? AS DATE) - CAST(race_date AS DATE)) <= 1
    """, [act_date]).fetchall()

    candidates = [
        (rid, abs(act_km - race_km), race_km)
        for rid, race_date_str, race_km in races
        if race_km > 0 and abs(act_km - race_km) / race_km <= 0.10
    ]
    if not candidates:
        return None

    # Tiebreak: closest distance
    race_event_id, _, race_km = min(candidates, key=lambda x: x[1])

    # Stamp activity on the race event
    stamp_race_activity(conn, race_event_id, activity["id"])

    avg_pace = (
        activity["moving_time_min"] / act_km
        if act_km and activity.get("moving_time_min") else None
    )
    race_time_h = activity["moving_time_min"] / 60.0 if activity.get("moving_time_min") else None

    analysis = {
        "race_event_id": race_event_id,
        "activity_id": activity["id"],
        "avg_pace_min_km": avg_pace,
        "comrades_projection_h": 0.0,
        "riegel_factor": 1.06,
    }

    if race_time_h:
        proj_h = update_comrades_projection(conn, race_event_id, {
            "activity_id": activity["id"],
            "race_distance_km": race_km,
            "race_time_h": race_time_h,
        })
        analysis["comrades_projection_h"] = proj_h

    return analysis


def update_comrades_projection(conn, race_event_id: int, race_result: dict) -> float:
    race_h = float(race_result["race_time_h"])
    race_km = float(race_result["race_distance_km"])
    riegel = race_h * (RACE_DISTANCE_KM / race_km) ** 1.06 * TERRAIN_FACTOR

    upsert_race_analysis(conn, {
        "race_event_id": race_event_id,
        "activity_id": race_result["activity_id"],
        "avg_pace_min_km": race_result.get("avg_pace_min_km"),
        "comrades_projection_h": round(riegel, 3),
        "riegel_factor": 1.06,
    })
    return round(riegel, 3)
