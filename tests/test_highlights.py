import pandas as pd
import pytest
from highlights import build_highlights, medal_for_time


def test_medal_for_time_boundaries():
    assert medal_for_time(5.5)  == "Wally Hayward"
    assert medal_for_time(6.0)  == "Silver"        # boundary belongs to next band
    assert medal_for_time(7.0)  == "Silver"
    assert medal_for_time(7.5)  == "Bill Rowan"
    assert medal_for_time(8.99) == "Bill Rowan"
    assert medal_for_time(9.0)  == "Robert Mtshali"
    assert medal_for_time(10.0) == "Bronze"
    assert medal_for_time(11.0) == "Vic Clapham"
    assert medal_for_time(12.0) == "outside the cutoff"


def test_high_ramp_gives_warning_and_mentions_percentage():
    text, style = build_highlights(
        ramp_pct=18.0, tsb=-5.0, projected_h=10.5, days_to_race=348,
        lr_quality_df=pd.DataFrame(), shoe_df=pd.DataFrame(),
    )
    assert style == "warning"
    assert "18%" in text
    assert "safe 10% ceiling" in text


def test_moderate_ramp_gives_warning():
    text, style = build_highlights(
        ramp_pct=12.0, tsb=-3.0, projected_h=10.5, days_to_race=348,
        lr_quality_df=pd.DataFrame(), shoe_df=pd.DataFrame(),
    )
    assert style == "warning"
    assert "12%" in text


def test_safe_ramp_with_fatigue_gives_info_and_mentions_fatigue():
    text, style = build_highlights(
        ramp_pct=6.0, tsb=-8.0, projected_h=10.5, days_to_race=348,
        lr_quality_df=pd.DataFrame(), shoe_df=pd.DataFrame(),
    )
    assert style == "info"
    assert "fatigue" in text.lower()


def test_safe_ramp_with_positive_form_gives_success():
    text, style = build_highlights(
        ramp_pct=5.0, tsb=8.0, projected_h=8.5, days_to_race=348,
        lr_quality_df=pd.DataFrame(), shoe_df=pd.DataFrame(),
    )
    assert style == "success"
    assert "recovered" in text.lower() or "fresh" in text.lower()


def test_projection_sentence_names_correct_medal_and_days():
    text, _ = build_highlights(
        ramp_pct=5.0, tsb=0.0, projected_h=8.0, days_to_race=200,
        lr_quality_df=pd.DataFrame(), shoe_df=pd.DataFrame(),
    )
    assert "Bill Rowan" in text
    assert "200 days" in text


def test_no_projection_prompts_25km_run():
    text, _ = build_highlights(
        ramp_pct=5.0, tsb=0.0, projected_h=None, days_to_race=348,
        lr_quality_df=pd.DataFrame(), shoe_df=pd.DataFrame(),
    )
    assert "25 km" in text


def test_overdue_shoe_triggers_warning_and_names_shoe():
    shoe_df = pd.DataFrame([{"name": "ASICS GT-2000", "km_remaining": -45.0}])
    text, style = build_highlights(
        ramp_pct=5.0, tsb=0.0, projected_h=10.5, days_to_race=348,
        lr_quality_df=pd.DataFrame(), shoe_df=shoe_df,
    )
    assert "ASICS GT-2000" in text
    assert style == "warning"


def test_shoe_close_to_retirement_appears_in_text():
    shoe_df = pd.DataFrame([{"name": "Nike Pegasus", "km_remaining": 30.0}])
    text, _ = build_highlights(
        ramp_pct=5.0, tsb=0.0, projected_h=10.5, days_to_race=348,
        lr_quality_df=pd.DataFrame(), shoe_df=shoe_df,
    )
    assert "Nike Pegasus" in text


def test_improving_long_run_quality_mentioned():
    # Ordered DESC (most recent first). Larger score = better = improving trend.
    lr_df = pd.DataFrame({"quality_score": [88.0, 80.0, 72.0, 65.0]})
    text, _ = build_highlights(
        ramp_pct=5.0, tsb=0.0, projected_h=10.5, days_to_race=348,
        lr_quality_df=lr_df, shoe_df=pd.DataFrame(),
    )
    assert "aerobic efficiency" in text.lower()


def test_declining_long_run_quality_mentioned():
    # Scores decreasing = most recent is worst = declining
    lr_df = pd.DataFrame({"quality_score": [55.0, 65.0, 75.0, 82.0]})
    text, _ = build_highlights(
        ramp_pct=5.0, tsb=0.0, projected_h=10.5, days_to_race=348,
        lr_quality_df=lr_df, shoe_df=pd.DataFrame(),
    )
    assert "long run quality" in text.lower() or "dipped" in text.lower()


def test_high_week_completion_appears_in_text():
    text, _ = build_highlights(
        ramp_pct=5.0, tsb=0.0, projected_h=10.5, days_to_race=350,
        lr_quality_df=pd.DataFrame(), shoe_df=pd.DataFrame(),
        week_completion_pct=92.0,
    )
    assert "complete" in text.lower() or "92%" in text


def test_fallback_sentence_includes_weeks_remaining():
    # 350 // 7 = 50 weeks. No shoes, no LR data, no week completion → fallback.
    text, _ = build_highlights(
        ramp_pct=5.0, tsb=0.0, projected_h=10.5, days_to_race=350,
        lr_quality_df=pd.DataFrame(), shoe_df=pd.DataFrame(),
    )
    assert "50 weeks" in text
