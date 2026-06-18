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
