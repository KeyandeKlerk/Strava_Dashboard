# Gym Tracker Navigation Redesign — Design

## Problem

The gym tracker's section navigation (`Plan` / `Insights` / `Weight`) is three plain underlined
text `<Link>`s bolted onto the corner of `/gym/page.tsx`
(`web/src/app/gym/page.tsx:17-25`, `text-xs text-neutral-500 underline`) — no active-state
indication, no visual weight, easy to miss as navigation at all. Meanwhile the app already has a
real tab visual language in `BottomNav` (`web/src/components/BottomNav.tsx`) that never made it
into this sub-section.

Separately, the live-session panel (`LiveSessionPanel`, hosting the rest timer, exercise queue,
and set-logging) only exists on `/gym` itself — stepping onto Plan/Insights/Weight mid-workout
loses sight of it entirely.

## Scope

- Redesign the `/gym/*` landing structure around a proper top tab bar: `Sessions | Plan | Insights
  | Weight`, replacing the ad-hoc link row.
- Add a compact, always-visible "live session" strip above the tab bar so an in-progress workout
  stays visible (and glanceable) no matter which gym tab you're on.
- Lift rest-timer state out of `RestTimer`'s local component state into `GymOfflineContext`, so
  the compact strip can show a live rest countdown consistent with the full panel.
- Out of scope: changing the four routes' actual content/data (Plan builder, Insights charts,
  Weight log, session history list are unchanged), icon set for `BottomNav`, any new persistence
  for rest-timer state (still resets on full reload, same as today), drag/reorder or any other
  feature work inside those pages.

## Design

### 1. Layout structure — `web/src/app/gym/layout.tsx`

Render order stays a simple vertical stack, top to bottom:

1. `GymStatusHeader` (unchanged)
2. **`CompactSessionBar`** (new) — renders only while a session is active
3. **`GymTabBar`** (new) — always rendered
4. `{children}` inside the existing `ViewTransition name="tab-content" share="tab-crossfade"` (untouched — crossfade already covers route switches within `/gym/*`, no changes needed for the new tab bar to inherit it)
5. `BottomNav` (unchanged — this is the app-level nav; the new tab bar is one level down, scoped to gym sub-sections)

`web/src/app/gym/page.tsx` drops its `Plan`/`Insights`/`Weight` link row (`web/src/app/gym/page.tsx:14-27`)
entirely — that's now `GymTabBar`'s job. It keeps `<LiveSessionPanel />` and `<GymHistoryList />`
under an (unchanged) "Recent sessions" heading. `/gym/plan`, `/gym/insights`, `/gym/bodyweight`
are untouched.

### 2. `GymTabBar` — new component

`web/src/components/gym/GymTabBar.tsx`, client component, `usePathname()`-driven active state —
same active-detection idiom as `BottomNav` (`pathname === href || pathname.startsWith(href + "/")`):

```tsx
const TABS = [
  { href: "/gym", label: "Sessions" },
  { href: "/gym/plan", label: "Plan" },
  { href: "/gym/insights", label: "Insights" },
  { href: "/gym/bodyweight", label: "Weight" },
];
```

Each tab is a `<Link>`, equal-width (`flex-1`), text-only (no icons — this is a distinct visual
register from `BottomNav`, deliberately plainer since it's a secondary nav one level down):

- Active: `border-b-2 border-violet-600 text-violet-600 dark:text-violet-400`
- Inactive: `border-b-2 border-transparent text-neutral-500 dark:text-neutral-400`
- Shared: `flex-1 py-2 text-center text-sm font-medium`, whole row sits on
  `border-b border-neutral-200 dark:border-neutral-800`

Reuses `BottomNav`'s violet-600 accent so the two nav layers read as one system, while staying
visually distinct (pills+icons at the bottom, underlined text tabs at the top) so they aren't
confused with each other.

### 3. Rest-timer state lift — `GymOfflineContext`

Today `RestTimer` (`web/src/components/gym/RestTimer.tsx`) owns the countdown as local
`setInterval` state, exposed only via `useImperativeHandle`/ref (`restTimerRef.current?.start()`
in `LiveSessionPanel.tsx:67`). Nothing outside `LiveSessionPanel` can observe it, which is why a
compact bar rendered in the layout (a sibling, not a descendant, of `LiveSessionPanel`) can't
currently show a countdown.

`GymOfflineContext` (`web/src/lib/gymOffline/context.tsx`) gains:

```ts
restEndsAt: number | null;       // absolute epoch-ms timestamp, not a decrementing counter
restPresetSeconds: number;
startRestTimer(): void;          // sets restEndsAt = Date.now() + restPresetSeconds * 1000
stopRestTimer(): void;           // sets restEndsAt = null
cycleRestPreset(): void;         // advances restPresetSeconds via existing nextRestTimerPreset(), persists via storeRestSeconds()
```

An absolute end-timestamp (not a per-tick decrement) is the right representation once two
components read it independently — each just computes `Math.max(0, Math.ceil((restEndsAt -
Date.now()) / 1000))` on its own 1s display-refresh interval, with no risk of drift between them.

The **completion beep** moves into a single `useEffect` inside `GymOfflineProvider` keyed on
`restEndsAt`: on each change, if non-null, schedule one `setTimeout` for the remaining ms that
calls `playRestTimerBeep()` and clears `restEndsAt`. This is the one place the side effect fires,
regardless of how many components (`RestTimer`, `CompactSessionBar`) are simultaneously rendering
the countdown — avoids a double-beep when both are mounted at once (true whenever you're on the
Sessions tab, since `CompactSessionBar` lives in the layout and `RestTimer` lives in that tab's
`LiveSessionPanel`).

`RestTimer.tsx` becomes a pure display + preset-cycling component: reads `restEndsAt` /
`restPresetSeconds` from `useGymOffline()`, ticks its own re-render interval, calls
`startRestTimer()` / `stopRestTimer()` / `cycleRestPreset()` directly. The `RestTimerHandle`/
`ref`/`useImperativeHandle` plumbing is deleted; `LiveSessionPanel`'s `onLogged={() =>
restTimerRef.current?.start()}` becomes `onLogged={startRestTimer}` (destructured straight from
`useGymOffline()`) — this is a net simplification, not just an added indirection.

No new persistence: `restEndsAt` is plain React state in the provider, resets on full reload,
identical behavior to today.

### 4. `CompactSessionBar` — new component

`web/src/components/gym/CompactSessionBar.tsx`, client component. Derives `activeSession` the
same way `LiveSessionPanel` does today (most-recent session in `sessions` with no `endedAt`) —
this derivation is extracted into a small shared helper (e.g. `getActiveSession(sessions)` in
`web/src/lib/gymOffline/context.tsx` or a sibling util) so the logic isn't duplicated between the
two components.

- No active session → renders `null` (zero height; tab bar sits directly under the header, same
  as today's visual weight).
- Active session → a single-row tappable link to `/gym`:
  - Live-dot (small red circle) + session label, reusing `LiveSessionPanel`'s existing
    `weekdayNameFor(activeSession.sessionDate)` helper (`web/src/components/gym/LiveSessionPanel.tsx:16-18`)
    to show e.g. "Monday session" — no new label data, just the same weekday name already computed
    today
  - Center/end: `restEndsAt` countdown if resting ("0:45 rest"), otherwise elapsed workout time
    computed from `activeSession.startedAt` vs `Date.now()` (ticking every second the same way)
  - Trailing: sets-logged count (`activeSessionSets.length`) and a chevron affordance
- Styling: violet-tinted pill, `flex items-center justify-between rounded-lg border
  border-violet-200 bg-violet-50 px-3 py-2 text-xs dark:border-violet-900
  dark:bg-violet-950/30` — echoes `PlanBuilder`'s existing violet "selected" treatment
  (`border-violet-300 bg-violet-50/50 dark:border-violet-900 dark:bg-violet-950/20`) so the accent
  reads consistently across the gym feature.
- Renders between `GymStatusHeader` and `GymTabBar` in the layout; tapping it is a normal Next.js
  navigation to `/gym` (no separate expand/collapse state — "expand" just means "go to the
  Sessions tab, where the full panel already lives").

## Error handling / edge cases

- Ending a session while on Plan/Insights/Weight: `CompactSessionBar` re-derives `activeSession`
  from `sessions` on every context update, so it disappears reactively the moment `endSession`
  patches the session's `endedAt` — no extra wiring needed.
- Offline: unaffected. Both new components read only from data already sourced from
  `GymOfflineContext`'s IndexedDB-backed cache, same as `LiveSessionPanel` today.
- Two ticking intervals (`RestTimer` and `CompactSessionBar`) reading the same `restEndsAt` is
  intentional and harmless — they're display-only re-renders; the one authoritative side effect
  (the beep) lives solely in the provider, per §3.
- A `restEndsAt` timestamp already in the past (e.g. tab was backgrounded through the rest period)
  renders as `0:00` momentarily until the provider's own `setTimeout` fires and clears it —
  acceptable since the beep firing late by however long the tab was backgrounded is the same
  trade-off `setTimeout`-based timers already have everywhere in this app.

## Testing

- `GymTabBar` active-state: for each of the four routes, only that tab renders with the active
  (violet, bordered) style; nested paths (should there ever be any under `/gym/plan/*` etc.)
  still match via the `startsWith` check.
- Rest timer: `startRestTimer()` sets `restEndsAt` to roughly `Date.now() + presetSeconds*1000`;
  `stopRestTimer()` clears it; the provider's completion effect fires `playRestTimerBeep()` exactly
  once when `restEndsAt` elapses, even with both `RestTimer` and `CompactSessionBar` mounted.
- `CompactSessionBar`: renders `null` with no active session; renders the countdown variant when
  `restEndsAt` is set and the elapsed-time variant when it isn't; disappears immediately after
  `endSession` is called for the active session.
- Manual QA (mobile viewport): start a session, navigate across all four tabs confirming the
  compact bar and its live countdown/elapsed time persist and keep ticking; log a set and confirm
  the rest countdown starts in both the compact bar and the full `RestTimer`; end the session and
  confirm the compact bar disappears; toggle offline in devtools and confirm both new components
  still work from cache.
