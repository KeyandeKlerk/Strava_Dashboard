# dashboard/shared.py
import html as html_lib
from datetime import date, timedelta

import pandas as pd
import streamlit as st

RACE_DATE = date(2027, 6, 13)
RACE_DISTANCE_KM = 90.0

# Comrades men's medal bands — (name, display_label, cutoff_hours).
# Gold (top 10 finishers) is position-based and omitted from time projections.
BANDS = [
    ("Wally Hayward",  "Sub 6:00",       6.0),
    ("Silver",         "6:00 – 7:29",    7.5),
    ("Bill Rowan",     "7:30 – 8:59",    9.0),
    ("Robert Mtshali", "9:00 – 9:59",   10.0),
    ("Bronze",         "10:00 – 10:59", 11.0),
    ("Vic Clapham",    "11:00 – 11:59", 12.0),
]

ICON = {
    "rest":        "⬜",
    "sc":          "💪",
    "easy_run":    "🟢",
    "quality_run": "🟡",
    "long_run":    "🔵",
    "hills":       "🟠",
    "cricket":     "🏏",
    "race":        "🏆",
}
INTENSITY_LABEL = {
    "easy": "Easy", "moderate": "Moderate", "hard": "Hard", "race": "RACE", "rest": "—",
}


def fmt_pace(min_per_km) -> str:
    if not min_per_km or min_per_km != min_per_km:
        return "—"
    total_sec = round(float(min_per_km) * 60)
    m, s = divmod(total_sec, 60)
    return f"{m}:{s:02d}"


def flag(value, low, high):
    if value is None or pd.isna(value):
        return "⚪"
    if low <= value <= high:
        return "🟢"
    if value < low * 0.9 or value > high * 1.15:
        return "🔴"
    return "🟡"


def week_label(row) -> str:
    start = row["week_start_date"]
    if hasattr(start, "date"):
        start = start.date()
    end = start + timedelta(days=6)
    deload_tag = " [DELOAD]" if row["is_deload"] else ""
    done = int(row["days_done"])
    total = int(row["total_days"])
    return (f"Wk {int(row['week_number']):02d}  {start.strftime('%b %d')}–{end.strftime('%d')}"
            f"  ·  {row['phase']}{deload_tag}  ·  {done}/{total} done")


DAILY_SESSIONS_CSS = """
.daily-sessions .ds-row {
    display: grid;
    grid-template-columns: 1fr 2fr 3fr 2fr 2fr 8fr;
    grid-template-areas: "status day session planned actual notes";
    gap: 8px;
    align-items: start;
    padding: 4px 0;
}
.daily-sessions .ds-header {
    border-bottom: 1px solid rgba(128,128,128,0.4);
    padding-bottom: 4px;
    margin-bottom: 4px;
}
.daily-sessions .ds-status  { grid-area: status; }
.daily-sessions .ds-day     { grid-area: day; }
.daily-sessions .ds-session { grid-area: session; }
.daily-sessions .ds-planned { grid-area: planned; }
.daily-sessions .ds-actual  { grid-area: actual; }
.daily-sessions .ds-notes   { grid-area: notes; }
.daily-sessions hr {
    margin: 2px 0;
    opacity: 0.3;
    border: none;
    border-top: 1px solid rgba(128,128,128,0.6);
}

@media (max-width: 640px) {
    .daily-sessions .ds-header { display: none; }
    .daily-sessions .ds-row {
        grid-template-columns: auto 1fr 1fr;
        grid-template-areas:
            "status day day"
            "session session session"
            "planned planned actual"
            "notes notes notes";
        gap: 2px 8px;
        border: 1px solid rgba(128,128,128,0.25);
        border-radius: 8px;
        padding: 8px 12px;
        margin-bottom: 8px;
    }
    .daily-sessions .ds-planned::before { content: "Planned "; opacity: 0.7; }
    .daily-sessions .ds-actual::before  { content: "Actual ";  opacity: 0.7; }
}
"""


def _daily_session_row_html(r, today: date, prev_date):
    icon   = ICON.get(str(r["session_type"]), "⬜")
    pdate  = r["planned_date"]
    pdate  = pdate.date() if hasattr(pdate, "date") else pdate
    status = "✅" if r["completed"] else ("⏳" if pdate >= today else "❌")
    plan_d   = f"{r['planned_km']:.0f} km" if r["planned_km"] and r["planned_km"] > 0 else "—"
    actual_d = f"{r['actual_km']:.1f} km" if r["actual_km"] else "—"
    session_label = f"{icon} {html_lib.escape(str(r['session_type']).replace('_', ' ').title())}"
    effort        = html_lib.escape(str(INTENSITY_LABEL.get(str(r["intensity"]), str(r["intensity"]))))
    description   = html_lib.escape(str(r["description"]))

    is_new_day = pdate != prev_date
    divider = '<hr class="ds-divider">' if (is_new_day and prev_date is not None) else ""
    day_str = (
        f"<strong>{html_lib.escape(str(r['day_of_week'])[:3])}</strong><br>{pdate.strftime('%b %d')}"
        if is_new_day else ""
    )

    row_html = (
        f'{divider}<div class="ds-row">'
        f'<div class="ds-cell ds-status">{status}</div>'
        f'<div class="ds-cell ds-day">{day_str}</div>'
        f'<div class="ds-cell ds-session">{session_label}<br><small>{effort}</small></div>'
        f'<div class="ds-cell ds-planned">{plan_d}</div>'
        f'<div class="ds-cell ds-actual">{actual_d}</div>'
        f'<div class="ds-cell ds-notes">{description}</div>'
        f'</div>'
    )
    return row_html, pdate


def daily_sessions_html(daily: pd.DataFrame, today: date) -> str:
    header_html = (
        '<div class="ds-row ds-header">'
        '<div class="ds-cell ds-status"><strong>·</strong></div>'
        '<div class="ds-cell ds-day"><strong>Day</strong></div>'
        '<div class="ds-cell ds-session"><strong>Session</strong></div>'
        '<div class="ds-cell ds-planned"><strong>Planned</strong></div>'
        '<div class="ds-cell ds-actual"><strong>Actual</strong></div>'
        '<div class="ds-cell ds-notes"><strong>Notes</strong></div>'
        '</div>'
    )

    rows = []
    prev_date = None
    for _, r in daily.iterrows():
        row_html, prev_date = _daily_session_row_html(r, today, prev_date)
        rows.append(row_html)

    return (
        f"<style>{DAILY_SESSIONS_CSS}</style>"
        f'<div class="daily-sessions">{header_html}{"".join(rows)}</div>'
    )


def render_daily_sessions(daily: pd.DataFrame, today: date) -> None:
    h0, h1, h2, h3, h4, h5 = st.columns([1, 2, 3, 2, 2, 8])
    h0.markdown("**·**")
    h1.markdown("**Day**")
    h2.markdown("**Session**")
    h3.markdown("**Planned**")
    h4.markdown("**Actual**")
    h5.markdown("**Notes**")
    st.markdown("<hr style='margin:4px 0'>", unsafe_allow_html=True)

    prev_date = None
    for _, r in daily.iterrows():
        icon          = ICON.get(str(r["session_type"]), "⬜")
        pdate         = r["planned_date"]
        pdate         = pdate.date() if hasattr(pdate, "date") else pdate
        status        = "✅" if r["completed"] else ("⏳" if pdate >= today else "❌")
        plan_d        = f"{r['planned_km']:.0f} km" if r["planned_km"] and r["planned_km"] > 0 else "—"
        actual_d      = f"{r['actual_km']:.1f} km" if r["actual_km"] else "—"
        session_label = f"{icon} {str(r['session_type']).replace('_', ' ').title()}"
        effort        = INTENSITY_LABEL.get(str(r["intensity"]), str(r["intensity"]))

        is_new_day = pdate != prev_date
        if is_new_day and prev_date is not None:
            st.markdown("<hr style='margin:2px 0; opacity:0.3'>", unsafe_allow_html=True)
        day_str = f"**{str(r['day_of_week'])[:3]}**  \n{pdate.strftime('%b %d')}" if is_new_day else ""
        prev_date = pdate

        c0, c1, c2, c3, c4, c5 = st.columns([1, 2, 3, 2, 2, 8])
        c0.write(status)
        c1.markdown(day_str)
        c2.markdown(f"{session_label}  \n<small>{effort}</small>", unsafe_allow_html=True)
        c3.write(plan_d)
        c4.write(actual_d)
        c5.markdown(str(r["description"]))
