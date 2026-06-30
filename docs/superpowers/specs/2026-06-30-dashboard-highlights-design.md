# Dashboard Highlights & Graph Filter Fix — Design Spec

**Date:** 2026-06-30  
**Files changed:** `dashboard/app.py`

---

## Problem 1 — Graphs Silently Cut Off Before Most Recent Data

**Root cause:** The date range filter uses a two-sided `st.date_input` (start + end). Streamlit persists widget values in session state, so if the end date was ever set to a past month (accidentally or deliberately), it sticks across all reruns until the session resets. Graphs then silently exclude recent activities even though the data is there.

**Secondary issue:** `ctl_atl_tsb_history` ignores `_date_filter()` entirely — it uses `CURRENT_DATE` directly in SQL. This makes the TSB chart show different data than every other chart.

**Fix:**
- Replace the two-sided range picker with a single **"Show from" date picker** (`_since` only). `_until` is always `date.today()` — hardcoded, no widget.
- Pass `_since`/`_until` bounds into `ctl_atl_tsb_history` so all charts filter consistently.

---

## Problem 2 — Medal Band Mapping Is Wrong

The existing `BANDS` array in `app.py` has incorrect cutoffs and is missing medals. Correct men's mapping (ignoring women's categories):

| Medal | Time range |
|---|---|
| Gold | Top 10 finishers (position-based — omit from time projections) |
| Wally Hayward | Sub 6:00 |
| Silver | 6:00 – 7:29 |
| Bill Rowan | 7:30 – 8:59 |
| Robert Mtshali | 9:00 – 9:59 |
| Bronze | 10:00 – 10:59 |
| Vic Clapham | 11:00 – 11:59 |
| Outside cutoff | 12:00+ |

Replace the `BANDS` constant and all medal-band logic in `app.py` with this table.

---

## Feature — Narrative Highlights Section

### Placement

Between the 5-metric header tile row (Days to Race, This Week km, Planned km, Adherence, Phase) and the Race Calendar section, after the first `st.divider()`.

### Style

- Rendered as a single flowing paragraph (no bullet points, no acronyms).
- `st.success()` (green) if the dominant signal is positive — training is safe, fitness is building, form is good.
- `st.warning()` (amber) if a caution condition is present — ramp rate > 15%, or training load vs 4-week average ratio > 1.3.
- `st.info()` (blue) for neutral / data-insufficient states.

### Content: 3 Sentences

All computed with pure Python rule-based logic from metrics already fetched on the page. No LLM.

---

**Sentence 1 — This week's load and injury risk**

Inputs: `weekly_ramp_rate` (current week's ramp %), `ctl_atl_tsb_history` (latest TSB — negative = fatigued, positive = fresh), `acwr_history` (ratio of 7-day load to 4-week average load).

Template logic (pick one branch):

- Ramp > 15%: *"Your training volume jumped [N]% over last week, which is above the safe 10% ceiling — a lighter session or two this week would reduce your injury risk."*
- Ramp 10–15%: *"You pushed [N]% more than last week — on the edge of the safe zone. Your body is carrying meaningful fatigue right now, so prioritise sleep and easy efforts."*
- Ramp safe (≤10%), TSB negative: *"You're carrying accumulated fatigue from a hard [N]-week block — your body is absorbing more load than it's recovering from, which is normal and intentional at this phase. Your training increase is [N]% — well within safe limits."*
- Ramp safe, TSB positive or near zero: *"You're in a well-recovered state after recent lighter training — your body has absorbed the load and you're carrying minimal fatigue heading into this week's sessions."*

---

**Sentence 2 — Fitness trajectory and race projection**

Inputs: `comrades_milestones` (projected finish time, CTL), days to race.

Template logic:

- Projection available: *"Based on your recent runs over 25 km, you're currently projecting a Comrades finish of around [H hours M minutes] — [medal name] pace — with [N] days left to build."*
- No projection yet (insufficient long run data): *"No finish-time projection yet — once you have a run of 25 km or more in the logs, the dashboard will estimate your Comrades pace."*

Medal name derives from corrected BANDS table above. Gold (top-10 position) is excluded from projection display.

---

**Sentence 3 — Single most important signal**

Priority order — pick the first condition that applies:

1. **Shoe retirement warning** — any shoe is past threshold or within 50 km: *"Your [shoe name] have [N] km on them and are due for retirement — racing in worn shoes increases injury risk significantly on Comrades' long descent."*
2. **Long run quality trending up** — quality score improved in 3 or more of the last 4 scored long runs: *"Your aerobic efficiency on long runs has improved for [N] consecutive sessions — you're holding pace at a lower heart rate, which is the most reliable signal that your Comrades fitness is genuinely developing."*
3. **Long run quality declining** — quality score dropped in 3 or more of the last 4 scored long runs: *"Your long run quality has dipped over the past [N] weeks — your heart rate is climbing relative to your pace on long efforts, which suggests accumulated fatigue. Prioritise a proper recovery week before your next long run."*
4. **Week completion** — if ≥ 90% of planned sessions this week are done: *"You're on track for a complete training week — [N] of [M] planned sessions done."*
5. **Fallback** — weeks to race milestone phrasing: *"You have [N] weeks of structured training remaining before the race — each quality long run in the next 8 weeks compounds your fitness more than any single session ever will."*

---

## Data Sourcing

All metric calls are already present lower in the page. To avoid double-fetching, hoist these calls to just below the header metrics row (before the highlights block) and reuse the DataFrames/dicts further down:

- `metrics.ctl_atl_tsb_history(conn)` — already called for the TSB chart
- `metrics.acwr_history(conn)` — already called for the ACWR chart
- `metrics.weekly_ramp_rate(conn)` — already called for the ramp chart
- `metrics.comrades_milestones(conn, ...)` — already called for the milestones section
- `metrics.long_run_quality_scores(conn)` — already called for the long run quality tab
- `metrics.shoe_mileage(conn)` — already called for the shoe section

Hoist all six calls above the highlights block. Assign to module-level variables at the top of the render flow and reference them in each section below.

---

## Out of Scope

- No changes to `src/metrics.py` SQL queries (except adding date bounds to `ctl_atl_tsb_history`).
- No new files.
- No changes to the ACWR, ramp, CTL/ATL/TSB, or zone charts beyond the date filter fix.
