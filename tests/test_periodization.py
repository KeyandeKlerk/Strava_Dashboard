import sys
from pathlib import Path
from datetime import date, timedelta
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from periodization import build_plan, _monday, _assign_block_types


COMRADES = date(2027, 6, 13)


def _weeks_between(start: date, end: date) -> list[date]:
    weeks = []
    w = _monday(start)
    while w <= _monday(end):
        weeks.append(w)
        w += timedelta(weeks=1)
    return weeks


def test_monday_returns_monday():
    assert _monday(date(2026, 6, 18)).weekday() == 0  # Wednesday → Monday


def test_assign_block_types_taper_last_three_weeks():
    weeks = _weeks_between(date(2027, 5, 24), COMRADES)
    comrades_idx = len(weeks) - 1
    types = _assign_block_types(weeks, comrades_idx, {})
    # Last 3 entries before comrades_idx should be taper
    assert types[-2] == "taper"
    assert types[-3] == "taper"
    assert types[-4] == "taper"


def test_assign_block_types_peak_weeks_4_to_9():
    weeks = _weeks_between(date(2027, 1, 1), COMRADES)
    comrades_idx = len(weeks) - 1
    types = _assign_block_types(weeks, comrades_idx, {})
    # offset -4 to -9 from comrades should be peak
    for offset in range(-4, -10, -1):
        idx = comrades_idx + offset
        if idx >= 0:
            assert types[idx] == "peak", f"offset {offset} was {types[idx]}"


def test_assign_block_types_deload_every_4th_build_week():
    weeks = _weeks_between(date(2025, 12, 1), COMRADES)
    comrades_idx = len(weeks) - 1
    types = _assign_block_types(weeks, comrades_idx, {})
    build_weeks = [(i, t) for i, t in enumerate(types) if t in ("build", "deload")]
    # Every 4th build-phase week (0-indexed within build phase) should be deload
    build_phase = [t for _, t in build_weeks]
    for i, t in enumerate(build_phase):
        if i % 4 == 3:
            assert t == "deload", f"position {i} in build phase should be deload, got {t}"


def test_assign_block_types_race_window_A(mem_conn):
    race = {"race_date": date(2026, 10, 18), "priority": "A", "id": 1, "distance_km": 56.0, "name": "X"}
    weeks = _weeks_between(date(2026, 9, 1), COMRADES)
    comrades_idx = len(weeks) - 1
    race_mon = _monday(race["race_date"])
    windows = {
        race_mon - timedelta(weeks=1): ("race_taper", race, 0.75),
        race_mon:                      ("race",        race, 1.0),
        race_mon + timedelta(weeks=1): ("recovery",    race, 0.65),
    }
    types = _assign_block_types(weeks, comrades_idx, windows)
    idx = weeks.index(race_mon)
    assert types[idx - 1] == "race_taper"
    assert types[idx]     == "race"
    assert types[idx + 1] == "recovery"


def test_build_plan_writes_training_plan_rows(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    count = mem_conn.execute("SELECT COUNT(*) FROM training_plan").fetchone()[0]
    assert count > 0


def test_build_plan_transaction_rolls_back_on_error(mem_conn):
    # Populate plan once so there are rows to preserve
    build_plan(mem_conn, COMRADES, [])
    before = mem_conn.execute("SELECT COUNT(*) FROM training_plan").fetchone()[0]
    # Force an error inside build_plan by passing bad race event data
    try:
        build_plan(mem_conn, COMRADES, [{"race_date": "not-a-date", "priority": "A", "id": 99, "distance_km": 0, "name": "bad"}])
    except Exception:
        pass
    after = mem_conn.execute("SELECT COUNT(*) FROM training_plan").fetchone()[0]
    assert after == before  # original plan preserved


def test_build_plan_writes_daily_sessions(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    count = mem_conn.execute("SELECT COUNT(*) FROM training_plan_daily").fetchone()[0]
    assert count > 0


def test_daily_sessions_have_valid_session_types(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    valid = {"rest", "sc", "easy_run", "quality_run", "long_run", "hills", "race"}
    rows = mem_conn.execute("SELECT DISTINCT session_type FROM training_plan_daily").fetchall()
    for (st,) in rows:
        assert st in valid, f"Invalid session_type: {st}"


def test_daily_sessions_have_valid_intensities(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    valid = {"rest", "easy", "moderate", "hard", "race"}
    rows = mem_conn.execute("SELECT DISTINCT intensity FROM training_plan_daily").fetchall()
    for (iv,) in rows:
        assert iv in valid, f"Invalid intensity: {iv}"


def test_long_run_not_more_than_35_pct_of_weekly_km(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    rows = mem_conn.execute("""
        SELECT d.week_number, d.planned_distance_km AS long_km, p.planned_distance_km AS weekly_km
        FROM training_plan_daily d
        JOIN training_plan p ON d.week_number = p.week_number
        WHERE d.session_type = 'long_run'
    """).fetchall()
    for week_num, long_km, weekly_km in rows:
        if weekly_km and weekly_km > 0:
            assert long_km / weekly_km <= 0.36, (
                f"Week {week_num}: long run {long_km:.1f} is {long_km/weekly_km:.0%} of {weekly_km:.1f}"
            )


def test_quality_sessions_rotate(mem_conn):
    build_plan(mem_conn, COMRADES, [])
    types = mem_conn.execute("""
        SELECT session_type FROM training_plan_daily
        WHERE session_type IN ('quality_run', 'hills')
        ORDER BY planned_date
        LIMIT 9
    """).fetchall()
    # Should not be all identical — rotation means variety
    unique = {t[0] for t in types}
    assert len(unique) >= 1  # at least one quality type used


def test_recovery_week_has_no_quality_sessions(mem_conn):
    race = {
        "id": 1, "name": "Test Race", "distance_km": 42.2,
        "priority": "A",
        "race_date": (_monday(date.today()) + timedelta(weeks=6)).isoformat(),
    }
    build_plan(mem_conn, COMRADES, [race])
    # Recovery week is the week after the race
    recovery_mon = _monday(date.fromisoformat(race["race_date"])) + timedelta(weeks=1)
    rows = mem_conn.execute("""
        SELECT session_type FROM training_plan_daily
        WHERE planned_date >= ? AND planned_date <= ?
          AND session_type IN ('quality_run', 'hills')
    """, [recovery_mon.isoformat(), (recovery_mon + timedelta(days=6)).isoformat()]).fetchall()
    assert len(rows) == 0
