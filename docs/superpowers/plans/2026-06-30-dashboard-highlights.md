# Dashboard Highlights & Graph Filter Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the date filter silently cutting off recent data, correct the Comrades medal band mapping, and add a 3-sentence plain-English narrative highlights panel at the top of the dashboard.

**Architecture:** All UI changes are confined to `dashboard/app.py`. Narrative generation logic is extracted to new `src/highlights.py` for unit testability. One small change to `src/metrics.py` makes `ctl_atl_tsb_history` respect the date filter. No new pages, no new dependencies.

**Tech Stack:** Streamlit, Plotly, pandas, DuckDB, pytest

## Global Constraints

- `dashboard/app.py` is the only UI file — all rendering changes go here.
- `sys.path.insert(0, str(Path(__file__).parent.parent / "src"))` is already in `app.py` line 10, so `from highlights import ...` works without additional path setup.
- `conftest.py` already inserts `src/` into `sys.path` and provides a `mem_conn` in-memory DuckDB fixture. All new tests use `mem_conn`.
- `metrics.TRAINING_START` and `metrics.TRAINING_END` are set at lines 55–56 of `app.py` before any chart data is fetched — all hoisted metric calls go AFTER those two lines.
- Do not add new pip dependencies, new Streamlit pages, or change the database schema.

---

### Task H1: Fix medal band constant

**Files:**
- Modify: `dashboard/app.py`

**Interfaces:**
- Produces: module-level `BANDS` list — `list[tuple[str, str, float]]` — `(name, display_label, cutoff_h)`; used in milestones display and (in Task H4) to derive projected medal label

The `BANDS` list is currently a local variable inside the `with band_col:` block (~line 729). It has wrong cutoffs and is missing Vic Clapham. This task extracts it as a module-level constant with correct men's values.

- [ ] **Step 1: Insert module-level BANDS constant**

Insert after `RACE_DISTANCE_KM = 90.0` (line 17), before `st.set_page_config(...)`:

```python
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
```

- [ ] **Step 2: Remove the old local BANDS definition**

Find and delete this block (inside `with band_col:`, ~line 729):

```python
        BANDS = [
            ("Wally Hayward", "Sub 6:00",           6.0),
            ("Gold",          "Sub 7:30",            7.5),
            ("Silver",        "Sub 9:00",            9.0),
            ("Bill Rowan",    "Sub 10:00",           10.0),
            ("Robert Mtshali","Sub 11:00",           11.0),
            ("Bronze",        "Sub 12:00 (cutoff)",  12.0),
        ]
```

The `for medal, label, cutoff_h in BANDS:` loop immediately below stays unchanged — it now reads the module-level constant.

- [ ] **Step 3: Verify in the browser**

Run: `streamlit run dashboard/app.py`

Navigate to **Comrades 2027 Milestones → Milestones tab → right column**. The medal list must show (in order): Wally Hayward, Silver, Bill Rowan, Robert Mtshali, Bronze, Vic Clapham, with correct time labels.

- [ ] **Step 4: Commit**

```bash
git add dashboard/app.py
git commit -m "fix: correct Comrades medal bands (Bill Rowan sub 9, add Vic Clapham, remove wrong Gold entry)"
```

---

### Task H2: Fix date filter and ctl_atl_tsb_history filter consistency

**Files:**
- Modify: `dashboard/app.py`
- Modify: `src/metrics.py`

**Interfaces:**
- `_since: date` — replaces the old `(_since, _until)` tuple; `_until` is now always `date.today()`
- `ctl_atl_tsb_history(conn, since=None, until=None)` — new optional params; output DataFrame is filtered to `[since, until]` after the full CTL/ATL computation (computation still runs over full history for accuracy)

- [ ] **Step 1: Replace the range date_input with a single "Show from" picker**

In `dashboard/app.py`, inside the `with _filter_col:` block (~lines 38–46), find:

```python
    _range = st.date_input(
        "Filter charts by date range",
        value=(_FILTER_MIN, date.today()),
        min_value=_FILTER_MIN,
        max_value=RACE_DATE,
        format="YYYY-MM-DD",
    )
```

Replace with:

```python
    _since = st.date_input(
        "Show from",
        value=_FILTER_MIN,
        min_value=_FILTER_MIN,
        max_value=date.today(),
        format="YYYY-MM-DD",
    )
```

- [ ] **Step 2: Replace the range-parsing block**

Find and replace the entire `if isinstance(_range, ...)` block (~lines 48–53):

```python
if isinstance(_range, (list, tuple)) and len(_range) == 2:
    _since, _until = _range
elif isinstance(_range, (list, tuple)) and len(_range) == 1:
    _since, _until = _range[0], date.today()
else:
    _since, _until = (_range if isinstance(_range, date) else _FILTER_MIN), date.today()
```

Replace with:

```python
if not isinstance(_since, date):
    _since = _FILTER_MIN
_until = date.today()
```

- [ ] **Step 3: Update ctl_atl_tsb_history signature in metrics.py**

In `src/metrics.py`, find:

```python
def ctl_atl_tsb_history(conn: duckdb.DuckDBPyConnection) -> pd.DataFrame:
```

Replace with:

```python
def ctl_atl_tsb_history(conn: duckdb.DuckDBPyConnection, since: Optional[str] = None, until: Optional[str] = None) -> pd.DataFrame:
```

Then find the final line of the function:

```python
    return pd.DataFrame(rows)
```

Replace with:

```python
    df = pd.DataFrame(rows)
    if since:
        df = df[df["day"].astype(str) >= since]
    if until:
        df = df[df["day"].astype(str) <= until]
    return df
```

- [ ] **Step 4: Write a failing test for the new filter params**

Add at the end of `tests/test_metrics.py`:

```python
def test_ctl_atl_tsb_history_filters_output_by_since_until(mem_conn):
    _insert_run(mem_conn, 1, "2026-01-15", 10.0)
    _insert_run(mem_conn, 2, "2026-02-15", 12.0)
    _insert_run(mem_conn, 3, "2026-03-15", 14.0)

    full = metrics.ctl_atl_tsb_history(mem_conn)
    assert not full.empty

    filtered = metrics.ctl_atl_tsb_history(mem_conn, since="2026-02-01", until="2026-02-28")
    assert not filtered.empty
    assert (filtered["day"].astype(str) >= "2026-02-01").all()
    assert (filtered["day"].astype(str) <= "2026-02-28").all()
    assert len(filtered) < len(full)
```

- [ ] **Step 5: Run the test to confirm it fails**

```bash
pytest tests/test_metrics.py::test_ctl_atl_tsb_history_filters_output_by_since_until -v
```

Expected: FAIL (function does not yet accept `since`/`until`)

- [ ] **Step 6: Apply the metrics.py change from Step 3, then re-run**

```bash
pytest tests/test_metrics.py::test_ctl_atl_tsb_history_filters_output_by_since_until -v
```

Expected: PASS

- [ ] **Step 7: Run full test suite to check for regressions**

```bash
pytest -v
```

Expected: all existing tests still PASS

- [ ] **Step 8: Verify in the browser**

Run: `streamlit run dashboard/app.py`

Confirm: the filter shows a single **"Show from"** date (no end date picker). Charts should now extend to today regardless of what the old filter had been set to.

- [ ] **Step 9: Commit**

```bash
git add dashboard/app.py src/metrics.py tests/test_metrics.py
git commit -m "fix: replace range date picker with single 'show from' date; ctl_atl_tsb_history now respects filter bounds"
```

---

### Task H3: Narrative highlights — pure function and tests

**Files:**
- Create: `src/highlights.py`
- Create: `tests/test_highlights.py`

**Interfaces:**
- Produces: `medal_for_time(projected_h: float) -> str` — maps a projected finish time in decimal hours to the correct medal name
- Produces: `build_highlights(ramp_pct, tsb, projected_h, days_to_race, lr_quality_df, shoe_df, week_completion_pct=None) -> tuple[str, str]` — returns `(narrative_paragraph, streamlit_style)` where style is `'success'`, `'warning'`, or `'info'`

`lr_quality_df` — DataFrame from `metrics.long_run_quality_scores()`, ordered DESC by date, column `quality_score` float 0–100.
`shoe_df` — DataFrame from `metrics.shoe_mileage()`, columns include `name: str`, `km_remaining: float`.
`week_completion_pct` — optional float 0–100, percentage of planned sessions completed in the current week.

- [ ] **Step 1: Write failing tests**

Create `tests/test_highlights.py`:

```python
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pytest tests/test_highlights.py -v
```

Expected: `ModuleNotFoundError: No module named 'highlights'`

- [ ] **Step 3: Create src/highlights.py**

```python
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
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_highlights.py -v
```

Expected: all 13 tests PASS

- [ ] **Step 5: Run full test suite**

```bash
pytest -v
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/highlights.py tests/test_highlights.py
git commit -m "feat: add narrative highlights function with unit tests"
```

---

### Task H4: Hoist metric calls and render highlights section

**Files:**
- Modify: `dashboard/app.py`

**Interfaces:**
- Consumes: `build_highlights` from `src/highlights.py`
- Consumes: `_tsb_df`, `_acwr_df`, `_ramp_df`, `_ms`, `_lrq_df`, `_shoe_df` — hoisted before the highlights block

This task has three parts: (A) add import + hoist 6 metric calls; (B) remove the now-duplicate calls and rename changed variables throughout the file; (C) insert the highlights rendering block.

- [ ] **Step 1: Add import for build_highlights**

After `import metrics` (~line 14), add:

```python
from highlights import build_highlights
```

- [ ] **Step 2: Hoist six metric calls**

Find the line:
```python
metrics.TRAINING_END   = _until.isoformat()
```

Immediately after it, insert:

```python

# ── Pre-fetch for highlights panel (DataFrames reused in sections below) ──────
_tsb_df  = metrics.ctl_atl_tsb_history(conn, since=metrics.TRAINING_START, until=metrics.TRAINING_END)
_acwr_df = metrics.acwr_history(conn)
_ramp_df = metrics.weekly_ramp_rate(conn)
_ms      = metrics.comrades_milestones(conn, race_distance_km=RACE_DISTANCE_KM)
_lrq_df  = metrics.long_run_quality_scores(conn)
_shoe_df = metrics.shoe_mileage(conn)
```

- [ ] **Step 3: Remove duplicate acwr_df call and rename its references**

Find and delete this line (in the Load & Risk section, ~line 282):
```python
acwr_df = metrics.acwr_history(conn)
```

Rename the three remaining references to `acwr_df` in the ACWR chart block:

a) Find:
```python
latest_acwr = acwr_df["acwr"].dropna().iloc[0] if not acwr_df.empty and acwr_df["acwr"].notna().any() else None
```
Replace with:
```python
latest_acwr = _acwr_df["acwr"].dropna().iloc[0] if not _acwr_df.empty and _acwr_df["acwr"].notna().any() else None
```

b) Find:
```python
with col_acwr:
    if not acwr_df.empty:
        fig_acwr = px.line(
            acwr_df.sort_values("day"),
```
Replace with:
```python
with col_acwr:
    if not _acwr_df.empty:
        fig_acwr = px.line(
            _acwr_df.sort_values("day"),
```

- [ ] **Step 4: Remove duplicate ramp_df call and rename its references**

Find and delete this line (in the Load & Risk section, ~line 282):
```python
ramp_df = metrics.weekly_ramp_rate(conn)
```

Rename the remaining references to `ramp_df`:

a) Find:
```python
latest_ramp = ramp_df["ramp_pct"].dropna().iloc[0] if not ramp_df.empty and ramp_df["ramp_pct"].notna().any() else None
```
Replace with:
```python
latest_ramp = _ramp_df["ramp_pct"].dropna().iloc[0] if not _ramp_df.empty and _ramp_df["ramp_pct"].notna().any() else None
```

b) Find:
```python
with col_ramp:
    if not ramp_df.empty:
        ramp_sorted = ramp_df.dropna(subset=["ramp_pct"]).sort_values("week_start").tail(16)
```
Replace with:
```python
with col_ramp:
    if not _ramp_df.empty:
        ramp_sorted = _ramp_df.dropna(subset=["ramp_pct"]).sort_values("week_start").tail(16)
```

- [ ] **Step 5: Remove duplicate _tsb_df call**

Find and delete this line (in the Load & Risk section, ~line 329):
```python
_tsb_df = metrics.ctl_atl_tsb_history(conn)
```

- [ ] **Step 6: Remove duplicate _shoe_df call**

Find and delete this line (in the Shoe Mileage section, ~line 443):
```python
_shoe_df = metrics.shoe_mileage(conn)
```

- [ ] **Step 7: Remove duplicate _lrq_df call**

Find and delete this line (in the Long Run Quality tab, ~line 632):
```python
    _lrq_df = metrics.long_run_quality_scores(conn)
```

- [ ] **Step 8: Remove duplicate ms call and rename all ms references**

Find and delete this line (in the Comrades Milestones section, ~line 668):
```python
ms = metrics.comrades_milestones(conn, race_distance_km=RACE_DISTANCE_KM)
```

Then rename every remaining `ms[` and `ms.get(` reference to `_ms[` and `_ms.get(`:

```
ms['longest_run_km']       → _ms['longest_run_km']
ms['longest_run_pct_race'] → _ms['longest_run_pct_race']
ms['total_gain_m']         → _ms['total_gain_m']
ms['total_descent_m']      → _ms['total_descent_m']
ms['descent_pct_practiced']→ _ms['descent_pct_practiced']
ms['race_descent_m']       → _ms['race_descent_m']
ms['runs_30plus']          → _ms['runs_30plus']
ms['runs_20plus']          → _ms['runs_20plus']
ms['max_b2b_km']           → _ms['max_b2b_km']
ms['projected_finish_h']   → _ms['projected_finish_h']
ms['cutoff_h']             → _ms['cutoff_h']
ms.get("projected_finish_h") → _ms.get("projected_finish_h")
```

- [ ] **Step 9: Insert the highlights rendering block**

Find this exact line:
```python
# ── Race Calendar ─────────────────────────────────────────────────────────────
```

Immediately before it, insert:

```python
# ── Highlights ────────────────────────────────────────────────────────────────
_latest_tsb  = float(_tsb_df["tsb"].iloc[-1]) if not _tsb_df.empty else None
_latest_ramp = (
    float(_ramp_df["ramp_pct"].dropna().iloc[0])
    if not _ramp_df.empty and _ramp_df["ramp_pct"].notna().any()
    else None
)

# Current week session completion from the training plan
_week_summary_hl = metrics.weekly_completion_summary(conn)
_week_completion_pct: float | None = None
if not _week_summary_hl.empty:
    _today_hl = date.today()
    for _, _wrow in _week_summary_hl.iterrows():
        _ws = _wrow["week_start_date"]
        _ws_date = _ws.date() if hasattr(_ws, "date") else _ws
        if _ws_date <= _today_hl < _ws_date + __import__("datetime").timedelta(days=7):
            _week_completion_pct = float(_wrow["completion_pct"] or 0)
            break

_hl_text, _hl_style = build_highlights(
    ramp_pct=_latest_ramp,
    tsb=_latest_tsb,
    projected_h=_ms.get("projected_finish_h"),
    days_to_race=days_to_race,
    lr_quality_df=_lrq_df,
    shoe_df=_shoe_df,
    week_completion_pct=_week_completion_pct,
)
if _hl_style == "success":
    st.success(_hl_text)
elif _hl_style == "warning":
    st.warning(_hl_text)
else:
    st.info(_hl_text)

```

- [ ] **Step 10: Verify the full dashboard in the browser**

Run: `streamlit run dashboard/app.py`

Check each of the following:
1. **Highlights panel** appears between the 5-metric header tiles and the Race Calendar section.
2. **Narrative** reads as a single flowing paragraph — 3 sentences, no acronyms (no CTL, ATL, TSB, ACWR).
3. **Panel colour** is green, amber, or blue — matches the training state (e.g. if ramp > 15% it should be amber/warning).
4. **Date filter** shows a single "Show from" date. Charts extend through today.
5. **Comrades Milestones** section still shows medal bands correctly (Wally Hayward through Vic Clapham).
6. **No Streamlit errors** in the terminal.

- [ ] **Step 11: Commit**

```bash
git add dashboard/app.py
git commit -m "feat: add narrative training highlights panel, hoist metric calls, fix date filter propagation"
```
