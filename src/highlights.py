from typing import Optional
import pandas as pd

MEDAL_BANDS = [
    ("Wally Hayward",  6.0),
    ("Silver",         7.5),
    ("Bill Rowan",     9.0),
    ("Robert Mtshali", 10.0),
    ("Bronze",         11.0),
    ("Vic Clapham",    12.0),
]


def medal_for_time(projected_h: float) -> str:
    for name, cutoff in MEDAL_BANDS:
        if projected_h < cutoff:
            return name
    return "outside the cutoff"


def _sentence_load(ramp_pct: Optional[float], tsb: Optional[float]) -> tuple[str, str]:
    if ramp_pct is None:
        return "Not enough training history yet to assess weekly load trends.", "info"
    ramp_str = f"{ramp_pct:+.0f}%"
    if ramp_pct > 15:
        return (
            f"Your training volume jumped {ramp_pct:.0f}% over last week, which is above the safe "
            "10% ceiling — a lighter session or two this week would reduce your injury risk.",
            "warning",
        )
    if ramp_pct > 10:
        return (
            f"You pushed {ramp_pct:.0f}% more volume than last week — on the edge of the safe zone. "
            "Your body is carrying meaningful fatigue right now, so prioritise sleep and easy efforts.",
            "warning",
        )
    if tsb is not None and tsb < -5:
        return (
            f"You're carrying accumulated fatigue from a recent hard block — your body is absorbing "
            f"more load than it's recovering from, which is normal and intentional at this phase. "
            f"Your training volume changed {ramp_str} this week, well within safe limits.",
            "info",
        )
    if tsb is not None and tsb > 5:
        return (
            f"You're in a well-recovered state — your body has absorbed recent training and you're "
            f"carrying minimal fatigue heading into this week's sessions. "
            f"Training volume changed {ramp_str} over last week.",
            "success",
        )
    return (
        f"Training load is well-managed — volume changed {ramp_str} over last week, within safe limits, "
        "and your fatigue and recovery are roughly in balance.",
        "info",
    )


def _sentence_projection(projected_h: Optional[float], days_to_race: int) -> str:
    if projected_h is None:
        return (
            "No finish-time projection yet — once you have a run of 25 km or more in the logs, "
            "the dashboard will estimate your Comrades pace."
        )
    medal = medal_for_time(projected_h)
    h = int(projected_h)
    m = int(round((projected_h - h) * 60))
    time_str = f"{h} hours {m} minutes" if m > 0 else f"{h} hours flat"
    return (
        f"Based on your recent runs over 25 km, you're currently projecting a Comrades finish of "
        f"around {time_str} — {medal} medal pace — with {days_to_race} days left to build."
    )


def _sentence_signal(
    lr_quality_df: pd.DataFrame,
    shoe_df: pd.DataFrame,
    days_to_race: int,
    week_completion_pct: Optional[float] = None,
) -> tuple[str, bool]:
    """Returns (sentence, is_warning)."""
    # Priority 1: shoe overdue
    if not shoe_df.empty:
        overdue = shoe_df[shoe_df["km_remaining"] < 0]
        if not overdue.empty:
            shoe = overdue.iloc[0]
            return (
                f"Your {shoe['name']} have {abs(shoe['km_remaining']):.0f} km past their retirement "
                "threshold — racing in worn shoes significantly increases injury risk on Comrades' long descent.",
                True,
            )
        close = shoe_df[(shoe_df["km_remaining"] >= 0) & (shoe_df["km_remaining"] < 50)]
        if not close.empty:
            shoe = close.iloc[0]
            return (
                f"Your {shoe['name']} have only {shoe['km_remaining']:.0f} km remaining before "
                "retirement — factor in a replacement before your next long run block.",
                False,
            )

    # Priority 2: long run quality trend (need ≥4 scored runs)
    if not lr_quality_df.empty and len(lr_quality_df) >= 4:
        scores = lr_quality_df["quality_score"].head(4).tolist()  # DESC order: most recent first
        improving = sum(1 for i in range(len(scores) - 1) if scores[i] > scores[i + 1])
        declining  = sum(1 for i in range(len(scores) - 1) if scores[i] < scores[i + 1])
        if improving >= 2:
            return (
                f"Your aerobic efficiency on long runs has improved in {improving} of the last "
                f"{len(scores) - 1} scored sessions — you're holding pace at a lower heart rate, "
                "which is the most reliable signal that your Comrades fitness is genuinely developing.",
                False,
            )
        if declining >= 2:
            return (
                "Your long run quality has dipped over recent sessions — heart rate is climbing "
                "relative to pace on long efforts, which suggests accumulated fatigue. "
                "Prioritise a proper recovery week before your next long run.",
                False,
            )

    # Priority 3: week completion ≥90%
    if week_completion_pct is not None and week_completion_pct >= 90:
        return (
            f"You're on track for a complete training week — {week_completion_pct:.0f}% of planned "
            "sessions ticked off, which puts consistency firmly in your favour heading into the weekend.",
            False,
        )

    # Fallback
    weeks_left = days_to_race // 7
    return (
        f"You have {weeks_left} weeks of structured training remaining — each quality long run "
        "in the next 8 weeks compounds your fitness more than any single session ever will.",
        False,
    )


def build_highlights(
    ramp_pct: Optional[float],
    tsb: Optional[float],
    projected_h: Optional[float],
    days_to_race: int,
    lr_quality_df: pd.DataFrame,
    shoe_df: pd.DataFrame,
    week_completion_pct: Optional[float] = None,
) -> tuple[str, str]:
    """Return (narrative_paragraph, streamlit_style).

    streamlit_style is one of: 'success', 'warning', 'info'.
    """
    s1, style = _sentence_load(ramp_pct, tsb)
    s2 = _sentence_projection(projected_h, days_to_race)
    s3, s3_is_warning = _sentence_signal(lr_quality_df, shoe_df, days_to_race, week_completion_pct)

    if s3_is_warning and style == "info":
        style = "warning"

    return f"{s1} {s2} {s3}", style
