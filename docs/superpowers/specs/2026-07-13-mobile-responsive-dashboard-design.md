# Mobile-Responsive Dashboard

**Date:** 2026-07-13

## Goal

The dashboard should be fully usable on a phone (target: full parity across all 6 tabs, not just a quick-glance subset), not just desktop. Streamlit already collapses `st.columns` to a single vertical column below ~640px, so most of the app (header metrics, Fatigue/Race Prep/Aerobic column groups, Plotly charts which resize to their container, `st.dataframe` tables which scroll natively) degrades acceptably as-is — it just gets a longer scroll. Two things don't degrade acceptably:

1. `render_daily_sessions()` in `dashboard/shared.py` (used by the Today tab and twice in Plan & History) lays each day out as 6 `st.columns`. Streamlit stacks those vertically below the breakpoint, turning every single day into 6 separate unlabeled fragments (status icon, day/date, session type, planned, actual, notes) with no visual grouping — unreadable on a phone.
2. The top-level nav (`st.tabs` in `dashboard/app.py`) has 6 labels, some long ("Aerobic Performance", "Plan & History"), which crowd or wrap awkwardly on a ~375px-wide screen.

## Approach

Pure CSS, no device detection, no new dependencies. The browser already reflows CSS media queries client-side — Python doesn't need to know the viewport size.

### 1. Responsive daily-session cards

Rewrite `render_daily_sessions()` in `dashboard/shared.py` to emit one HTML block per day (via `st.markdown(..., unsafe_allow_html=True)`) using CSS Grid, instead of `st.columns`:

- Desktop (≥640px): a grid row per day with `grid-template-columns` matching today's `[1, 2, 3, 2, 2, 8]` proportions (status · day/date · session+effort · planned · actual · notes), visually equivalent to the current table. Column headers (Day/Session/Planned/Actual/Notes) render once above the grid, as today.
- Mobile (<640px): a media query switches each day's grid to a single-column stacked card:
  ```
  ✅  Mon Jul 14
  🟢 Easy Run          Easy
  Planned 8 km · Actual 8.2 km
  Zone 2 recovery jog
  ```
  Status icon + day/date on one line, session type + effort below, planned/actual combined onto one inline line, description last. The column-header row is hidden on mobile (`display: none` inside the media query) since each field is self-labeled inline.
- New-day dividers (the existing `<hr>` between different days) are kept in both layouts.
- All existing inputs/behavior are unchanged: same `daily: pd.DataFrame` and `today: date` signature, same icon/status/effort logic from `ICON`, `INTENSITY_LABEL`.

### 2. Nav tab bar

Add `inject_responsive_css()` to `dashboard/shared.py`: a single `st.markdown("<style>...</style>", unsafe_allow_html=True)` call with a `max-width: 640px` media query targeting Streamlit's tab-bar DOM (`[data-baseweb="tab-list"]` and its tab elements) that:
- shrinks tab font-size/padding, and
- sets `overflow-x: auto` with `white-space: nowrap` on the tab list, so if 6 shrunk labels still don't fit, the bar scrolls horizontally instead of wrapping to multiple lines.

Call `inject_responsive_css()` once from `dashboard/app.py`, near the top (after `st.set_page_config`, before the header row).

Caveat: this targets Streamlit's internal `data-baseweb` attributes, which aren't a public API and could shift in a future Streamlit upgrade. Acceptable trade-off for a small, self-contained CSS block — if it silently stops matching after an upgrade, the tab bar just reverts to today's (functional, if crowded) behavior, it doesn't break anything.

### Everything else — unchanged

No changes to `today.py`, `fatigue.py`, `race_prep.py`, `aerobic.py`, `training_load.py`, or `plan_history.py` beyond their existing calls to `render_daily_sessions()`. Their `st.columns` groups, `st.metric` cards, Plotly charts, and `st.dataframe` tables already stack/resize/scroll acceptably on a narrow screen and don't need code changes.

## Non-goals

- No JS-based viewport/device detection, no new Python or JS dependencies.
- No changes to any chart, metric, or table beyond the daily-sessions renderer and the tab-bar CSS.
- No PWA features (add-to-homescreen, offline support, etc.) — this is a responsive-layout fix, not a native-app wrapper.
- No changes to `metrics.py`, `db.py`, `sync.py`, or any data/computation logic.

## Testing

- No pure-function surface to unit test here — `render_daily_sessions()` and `inject_responsive_css()` are Streamlit rendering code, and the existing `tests/test_dashboard_shared.py` already only covers pure helpers (`fmt_pace`, `flag`), consistent with this repo's pattern of not unit-testing Streamlit UI code.
- Manual verification: run `streamlit run dashboard/app.py`, then in Chrome DevTools device emulation:
  - Check an iPhone SE-width (375px) viewport: confirm daily-session cards stack per the mobile layout above (with description/notes visible, no clipped text), confirm the 6-tab nav either fits on one line or scrolls horizontally without wrapping.
  - Check a normal desktop-width viewport: confirm the daily-sessions grid still looks like today's 6-column table (no regression) and the tab bar is unchanged.
  - Spot-check both the Today tab and the Plan & History tab (including the "All weeks" expander drill-down), since both call `render_daily_sessions()`.
