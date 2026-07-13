# tests/test_dashboard_shared.py
import sys
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent / "dashboard"))

from shared import fmt_pace, flag, daily_sessions_html, DAILY_SESSIONS_CSS


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


def _row(**overrides):
    base = {
        "planned_date": pd.Timestamp("2026-07-14"),
        "day_of_week": "Monday",
        "session_type": "easy_run",
        "planned_km": 8.0,
        "intensity": "easy",
        "completed": True,
        "actual_km": 8.2,
        "description": "Zone 2 recovery jog",
    }
    base.update(overrides)
    return base


def test_daily_sessions_html_includes_desktop_grid_and_mobile_media_query():
    html = daily_sessions_html(pd.DataFrame([_row()]), today=date(2026, 7, 14))
    assert "grid-template-columns: 1fr 2fr 3fr 2fr 2fr 8fr" in html
    assert "@media (max-width: 640px)" in html
    assert 'content: "Planned ";' in html
    assert 'content: "Actual ";' in html


def test_daily_sessions_html_renders_session_details():
    html = daily_sessions_html(pd.DataFrame([_row()]), today=date(2026, 7, 14))
    assert "✅" in html
    assert "Easy Run" in html
    assert "8 km" in html
    assert "8.2 km" in html
    assert "Zone 2 recovery jog" in html
    assert "Mon" in html
    assert "Jul 14" in html


def test_daily_sessions_html_marks_incomplete_future_session_as_pending():
    html = daily_sessions_html(
        pd.DataFrame([_row(completed=False, planned_date=pd.Timestamp("2026-07-20"))]),
        today=date(2026, 7, 14),
    )
    assert "⏳" in html


def test_daily_sessions_html_marks_incomplete_past_session_as_missed():
    html = daily_sessions_html(
        pd.DataFrame([_row(completed=False, planned_date=pd.Timestamp("2026-07-10"))]),
        today=date(2026, 7, 14),
    )
    assert "❌" in html


def test_daily_sessions_html_shows_dash_for_missing_planned_distance():
    html = daily_sessions_html(
        pd.DataFrame([_row(planned_km=float("nan"))]), today=date(2026, 7, 14)
    )
    assert "—" in html


def test_daily_sessions_html_new_day_divider_only_between_different_days():
    same_day = pd.DataFrame([
        _row(session_type="sc", day_of_week="Monday"),
        _row(session_type="easy_run", day_of_week="Monday"),
    ])
    html_same_day = daily_sessions_html(same_day, today=date(2026, 7, 14))
    assert html_same_day.count("ds-divider") == 0

    two_days = pd.DataFrame([
        _row(planned_date=pd.Timestamp("2026-07-14"), day_of_week="Monday"),
        _row(planned_date=pd.Timestamp("2026-07-15"), day_of_week="Tuesday"),
    ])
    html_two_days = daily_sessions_html(two_days, today=date(2026, 7, 14))
    assert html_two_days.count("ds-divider") == 1


def test_daily_sessions_html_second_session_same_day_has_no_repeated_day_label():
    same_day = pd.DataFrame([
        _row(session_type="sc", day_of_week="Monday"),
        _row(session_type="easy_run", day_of_week="Monday"),
    ])
    html = daily_sessions_html(same_day, today=date(2026, 7, 14))
    assert html.count("Mon</strong>") == 1


def test_daily_sessions_html_escapes_html_special_characters_in_description():
    html = daily_sessions_html(
        pd.DataFrame([_row(description='<script>alert(1)</script> & "quotes"')]),
        today=date(2026, 7, 14),
    )
    assert "<script>alert" not in html
    assert "&lt;script&gt;" in html


def test_daily_sessions_css_constant_is_embedded_in_output():
    html = daily_sessions_html(pd.DataFrame([_row()]), today=date(2026, 7, 14))
    assert DAILY_SESSIONS_CSS in html
