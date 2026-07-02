# tests/test_dashboard_shared.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "dashboard"))

from shared import fmt_pace, flag


def test_fmt_pace_formats_minutes_and_seconds():
    assert fmt_pace(5.5) == "5:30"


def test_fmt_pace_handles_none():
    assert fmt_pace(None) == "—"


def test_fmt_pace_handles_nan():
    assert fmt_pace(float("nan")) == "—"


def test_flag_green_in_range():
    assert flag(1.0, 0.8, 1.3) == "🟢"


def test_flag_red_far_outside_range():
    assert flag(2.0, 0.8, 1.3) == "🔴"


def test_flag_yellow_near_edge():
    assert flag(1.35, 0.8, 1.3) == "🟡"


def test_flag_white_circle_for_missing_value():
    assert flag(None, 0.8, 1.3) == "⚪"
