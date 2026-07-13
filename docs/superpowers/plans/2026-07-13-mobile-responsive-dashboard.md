# Mobile-Responsive Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Streamlit dashboard usable on a phone by rewriting the daily-sessions table as responsive HTML/CSS cards and shrinking the tab bar on narrow screens — pure CSS, no device detection, no new dependencies.

**Architecture:** `dashboard/shared.py` gains two pure, testable string-building functions (`daily_sessions_html`, and a `TAB_RESPONSIVE_CSS` constant) plus two thin Streamlit-calling wrappers (`render_daily_sessions`, `inject_responsive_css`). The pure functions are unit tested; the thin wrappers are verified manually since they only call `st.markdown` with no logic of their own. `dashboard/app.py` calls `inject_responsive_css()` once at startup.

**Tech Stack:** Python, Streamlit 1.58.0, pandas. No new dependencies.

## Global Constraints

- Pure CSS only — no JavaScript viewport/device detection, no new Python or JS packages (per spec).
- Breakpoint is `640px` everywhere (per spec).
- No changes to `metrics.py`, `db.py`, `sync.py`, or any data/computation logic (per spec).
- No changes to `today.py`, `fatigue.py`, `race_prep.py`, `aerobic.py`, `training_load.py`, or `plan_history.py` beyond their existing calls to `render_daily_sessions()` — those files are not touched by this plan (per spec).
- No PWA features (per spec).
- The tab-bar CSS selectors must be ones verified to exist in the installed Streamlit 1.58.0 frontend bundle: `[data-testid="stTabs"]`, `[role="tablist"]`, `[role="tab"]` (confirmed present via `grep` on `.venv/lib/python3.14/site-packages/streamlit/static/static/js/index.dkY5s53S.js`). Streamlit's tab component already shows its own horizontal-scroll arrow buttons (`data-testid="stTabsScrollLeft"`/`"stTabsScrollRight"`) when tabs overflow their container — do not add a competing `overflow-x`/scroll rule; only shrink font-size/padding so more tabs fit before that native overflow kicks in.

---

### Task 1: Responsive daily-sessions HTML/CSS builder

**Files:**
- Modify: `dashboard/shared.py:1-9` (imports), and insert new code before the existing `render_daily_sessions` (currently `dashboard/shared.py:66-99`)
- Test: `tests/test_dashboard_shared.py`

**Interfaces:**
- Produces: `daily_sessions_html(daily: pd.DataFrame, today: date) -> str` — pure function, no Streamlit calls. Takes the same DataFrame shape as `metrics.daily_plan_for_week()` returns (columns: `planned_date`, `day_of_week`, `session_type`, `planned_km`, `intensity`, `completed`, `actual_km`, `description`) and the same `today: date` argument `render_daily_sessions` already receives. Returns a single HTML string (including its own `<style>` block).
- Produces: `DAILY_SESSIONS_CSS: str` — module-level constant, the raw CSS (no `<style>` tags) embedded inside `daily_sessions_html`'s output.
- Consumes: existing `ICON` and `INTENSITY_LABEL` dicts already defined in `dashboard/shared.py`.

This task only builds and tests the pure HTML-string function. Task 2 wires it into `render_daily_sessions`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_dashboard_shared.py` (append after the existing tests, add new imports at the top):

```python
# tests/test_dashboard_shared.py
import sys
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent / "dashboard"))

from shared import fmt_pace, flag, daily_sessions_html, DAILY_SESSIONS_CSS


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_dashboard_shared.py -v`
Expected: `ImportError: cannot import name 'daily_sessions_html' from 'shared'` (or similar collection error) — the function doesn't exist yet.

- [ ] **Step 3: Implement `daily_sessions_html` and `DAILY_SESSIONS_CSS` in `dashboard/shared.py`**

Modify the top of `dashboard/shared.py` — change:

```python
# dashboard/shared.py
from datetime import date, timedelta

import pandas as pd
import streamlit as st
```

to:

```python
# dashboard/shared.py
import html as html_lib
from datetime import date, timedelta

import pandas as pd
import streamlit as st
```

Then insert the following new code immediately before the existing `def render_daily_sessions(...)` function (i.e. before current `dashboard/shared.py:66`):

```python
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
.daily-sessions .ds-divider {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_dashboard_shared.py -v`
Expected: all tests PASS, including the new `test_daily_sessions_html_*` and `test_daily_sessions_css_constant_is_embedded_in_output` tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/shared.py tests/test_dashboard_shared.py
git commit -m "feat: add responsive HTML/CSS builder for daily sessions"
```

---

### Task 2: Wire `render_daily_sessions` to the new HTML builder

**Files:**
- Modify: `dashboard/shared.py` (replace the existing `render_daily_sessions` function body, currently `dashboard/shared.py:66-99`)

**Interfaces:**
- Consumes: `daily_sessions_html(daily: pd.DataFrame, today: date) -> str` from Task 1.
- Produces: `render_daily_sessions(daily: pd.DataFrame, today: date) -> None` — same public signature as before, called unchanged by `dashboard/tabs/today.py` and `dashboard/tabs/plan_history.py`.

No new automated test here — `render_daily_sessions` is a one-line wrapper around a Streamlit call with no logic of its own (the logic it used to contain is now in `daily_sessions_html`, already covered by Task 1's tests). It's verified manually in Task 4, consistent with this repo's existing pattern of not unit-testing Streamlit rendering calls (see `tests/test_dashboard_shared.py`, which only tests pure helpers).

- [ ] **Step 1: Replace the old column-based implementation**

Delete the entire existing function body (currently `dashboard/shared.py:66-99`):

```python
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
```

Replace it with:

```python
def render_daily_sessions(daily: pd.DataFrame, today: date) -> None:
    st.markdown(daily_sessions_html(daily, today), unsafe_allow_html=True)
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

Run: `pytest -v`
Expected: all tests PASS (same set as before this task, since `render_daily_sessions` itself has no tests — this just confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add dashboard/shared.py
git commit -m "refactor: render daily sessions as responsive HTML cards instead of st.columns"
```

---

### Task 3: Responsive tab bar CSS

**Files:**
- Modify: `dashboard/shared.py` (add `TAB_RESPONSIVE_CSS` constant and `inject_responsive_css()` function, appended after `render_daily_sessions`)
- Modify: `dashboard/app.py:13,16-19` (import and call the new function)
- Test: `tests/test_dashboard_shared.py`

**Interfaces:**
- Produces: `TAB_RESPONSIVE_CSS: str` — module-level constant, raw CSS.
- Produces: `inject_responsive_css() -> None` — calls `st.markdown` with `TAB_RESPONSIVE_CSS` wrapped in `<style>` tags and `unsafe_allow_html=True`. No return value, no inputs.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_dashboard_shared.py` (extend the existing import line and add one test):

Change:

```python
from shared import fmt_pace, flag, daily_sessions_html, DAILY_SESSIONS_CSS
```

to:

```python
from shared import fmt_pace, flag, daily_sessions_html, DAILY_SESSIONS_CSS, TAB_RESPONSIVE_CSS
```

Add:

```python
def test_tab_responsive_css_targets_stTabs_and_shrinks_below_640px():
    assert '[data-testid="stTabs"]' in TAB_RESPONSIVE_CSS
    assert '[role="tab"]' in TAB_RESPONSIVE_CSS
    assert "@media (max-width: 640px)" in TAB_RESPONSIVE_CSS
    assert "overflow-x" not in TAB_RESPONSIVE_CSS
```

(The last assertion pins the Global Constraint that we must not add a competing `overflow-x` rule on top of Streamlit's own native tab-overflow scroll buttons.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_dashboard_shared.py -v`
Expected: `ImportError: cannot import name 'TAB_RESPONSIVE_CSS' from 'shared'`

- [ ] **Step 3: Implement `TAB_RESPONSIVE_CSS` and `inject_responsive_css()`**

Append to the end of `dashboard/shared.py`, after `render_daily_sessions`:

```python
TAB_RESPONSIVE_CSS = """
@media (max-width: 640px) {
    [data-testid="stTabs"] [role="tab"] {
        font-size: 0.75rem;
        padding: 8px 10px;
    }
}
"""


def inject_responsive_css() -> None:
    st.markdown(f"<style>{TAB_RESPONSIVE_CSS}</style>", unsafe_allow_html=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_dashboard_shared.py -v`
Expected: all tests PASS, including the new `test_tab_responsive_css_targets_stTabs_and_shrinks_below_640px`.

- [ ] **Step 5: Call `inject_responsive_css()` from `app.py`**

In `dashboard/app.py`, change line 13:

```python
from shared import RACE_DATE, RACE_DISTANCE_KM
```

to:

```python
from shared import RACE_DATE, RACE_DISTANCE_KM, inject_responsive_css
```

Then change lines 16-21:

```python
st.set_page_config(
    page_title="Comrades 2027 Training",
    layout="wide",
)

conn = get_conn()
```

to:

```python
st.set_page_config(
    page_title="Comrades 2027 Training",
    layout="wide",
)
inject_responsive_css()

conn = get_conn()
```

- [ ] **Step 6: Run the full test suite**

Run: `pytest -v`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/shared.py dashboard/app.py
git commit -m "feat: shrink tab bar on narrow screens via responsive CSS"
```

---

### Task 4: Manual verification across breakpoints

**Files:** none (verification only — no code changes)

**Interfaces:** none.

This exercises the actual rendered app in a browser, which the automated tests in Tasks 1-3 can't cover (they test the pure HTML/CSS-string builders, not what a real browser does with that HTML at a given viewport width).

- [ ] **Step 1: Start the app**

Run: `streamlit run dashboard/app.py`
Expected: app starts and prints a local URL (e.g. `http://localhost:8501`).

- [ ] **Step 2: Verify desktop width (no regression)**

Open the app in a browser at a normal desktop window width (≥1000px). Confirm:
- The daily-sessions table under "This Week's Plan" (Today tab) still looks like a 6-column table (status · day · session · planned · actual · notes), matching the pre-change layout.
- The 6 top-level tabs ("Today", "Fatigue", "Training Load", "Aerobic Performance", "Race Prep", "Plan & History") render at their normal size, unchanged.

- [ ] **Step 3: Verify mobile width — Today tab**

In Chrome DevTools, toggle device toolbar and select "iPhone SE" (375px width) or set a custom 375px viewport. Reload the app. On the **Today** tab, confirm:
- Each day in "This Week's Plan" renders as a bordered card (icon+day on one line, session+effort below, "Planned"/"Actual" labels visible, notes at the bottom) — not a squished row of 6 stacked fragments.
- No horizontal scrollbar appears on the page body.
- The column header row (Day/Session/Planned/Actual/Notes) is not shown (it's replaced by the inline labels on each card).

- [ ] **Step 4: Verify mobile width — Plan & History tab**

Still at 375px width, open the **Plan & History** tab. Confirm:
- The week selector's daily-sessions drill-down (bottom of the page) renders as cards, same as Today.
- Expand "All weeks — overview" and click a row to drill into a different week — confirm that drill-down's daily sessions also render as cards (this is the second call site sharing `render_daily_sessions`).

- [ ] **Step 5: Verify the tab bar at mobile width**

Still at 375px width, look at the top-level tab bar. Confirm:
- Tab labels are visibly smaller than at desktop width.
- If all 6 tabs still don't fit, Streamlit's native left/right scroll arrows appear and let you scroll to hidden tabs (do not expect them to wrap to multiple lines).

- [ ] **Step 6: Stop the app**

Stop the `streamlit run` process (Ctrl+C in its terminal).

No commit for this task (no code changes) — if any step fails, fix the issue in the relevant earlier task's files, re-run that task's tests, then restart this task from Step 1.
