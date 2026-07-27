# Gym Tracker Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gym tracker's plain-text `Plan`/`Insights`/`Weight` links with a real top tab bar (`Sessions | Plan | Insights | Weight`), and add a compact always-visible live-session strip (with a working rest-timer countdown) above it so an in-progress workout stays visible on every gym tab.

**Architecture:** Two new small client components (`GymTabBar`, `CompactSessionBar`) render in `web/src/app/gym/layout.tsx`, above the existing `{children}` view-transition slot. Rest-timer state moves from `RestTimer.tsx`'s local `setInterval`/ref into `GymOfflineContext`, as an absolute end-timestamp, so both the full panel and the compact strip can read the same live countdown. Session-selection and time-formatting logic is extracted into small pure, unit-tested functions, following this codebase's existing convention (see `exerciseKey.ts`, `gymRestTimer.ts`) of keeping business logic outside React so it's testable without a DOM/React-testing-library setup (neither is installed in this repo — don't add one).

**Tech Stack:** Next.js (App Router, "use client" components), Tailwind v4 (CSS-first tokens, no config file), Vitest (`environment: "node"`, no jsdom/RTL), IndexedDB via the existing `idb`-based `gymOffline/db.ts`.

**Spec:** `docs/superpowers/specs/2026-07-27-gym-tracker-nav-redesign-design.md`

## Global Constraints

- No new dependencies (no icon library, no animation library, no testing-library package) — this repo's gym feature deliberately avoids them (see spec + existing components).
- No new IndexedDB persistence for rest-timer state — it stays in-memory React state in `GymOfflineContext`, resetting on full reload, identical to today's behavior.
- Follow the existing pure-logic-plus-`.test.ts` pattern for anything unit-testable; React component/effect wiring is verified via `npm run build`, `npm run lint`, and manual QA in the browser — this repo has no React Testing Library/jsdom, so do not write component-render tests.
- Tailwind utility classes only (no CSS Modules), matching every existing gym component.
- Preserve the offline-first behavior: every new component must read state only from `useGymOffline()` (IndexedDB-backed), never add a server fetch to `gym/layout.tsx` or `gym/page.tsx` (see the header comments in both files explaining why).

---

### Task 1: Extract pure live-session helpers

**Files:**
- Create: `web/src/lib/gymOffline/liveSession.ts`
- Test: `web/src/lib/gymOffline/liveSession.test.ts`
- Modify: `web/src/components/gym/LiveSessionPanel.tsx`

**Interfaces:**
- Produces: `getActiveSession(sessions: CachedSession[]): CachedSession | undefined`, `formatMmSs(totalSeconds: number): string`, `computeRemainingSeconds(endsAt: number | null, now: number): number | null` — all exported from `web/src/lib/gymOffline/liveSession.ts`. Later tasks (2, 5) import these.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/gymOffline/liveSession.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CachedSession } from "./db";
import { computeRemainingSeconds, formatMmSs, getActiveSession } from "./liveSession";

function makeSession(overrides: Partial<CachedSession> = {}): CachedSession {
  return {
    clientUuid: "s1",
    id: null,
    sessionDate: "2026-07-27",
    startedAt: "2026-07-27T10:00:00.000Z",
    endedAt: null,
    activityId: null,
    notes: null,
    ...overrides,
  };
}

describe("getActiveSession", () => {
  it("returns undefined when there are no sessions", () => {
    expect(getActiveSession([])).toBeUndefined();
  });

  it("ignores sessions that have ended", () => {
    const ended = makeSession({ clientUuid: "ended", endedAt: "2026-07-27T11:00:00.000Z" });
    expect(getActiveSession([ended])).toBeUndefined();
  });

  it("returns the most recently started session with no endedAt", () => {
    const older = makeSession({ clientUuid: "older", startedAt: "2026-07-27T09:00:00.000Z" });
    const newer = makeSession({ clientUuid: "newer", startedAt: "2026-07-27T10:00:00.000Z" });
    expect(getActiveSession([older, newer])).toEqual(newer);
  });

  it("skips ended sessions even if started more recently than an active one", () => {
    const active = makeSession({ clientUuid: "active", startedAt: "2026-07-27T09:00:00.000Z" });
    const endedLater = makeSession({
      clientUuid: "ended-later",
      startedAt: "2026-07-27T10:00:00.000Z",
      endedAt: "2026-07-27T10:30:00.000Z",
    });
    expect(getActiveSession([active, endedLater])).toEqual(active);
  });
});

describe("formatMmSs", () => {
  it("formats sub-minute durations with a leading zero on seconds", () => {
    expect(formatMmSs(45)).toBe("0:45");
    expect(formatMmSs(5)).toBe("0:05");
  });

  it("formats multi-minute durations", () => {
    expect(formatMmSs(125)).toBe("2:05");
    expect(formatMmSs(600)).toBe("10:00");
  });

  it("clamps negative input to 0:00", () => {
    expect(formatMmSs(-5)).toBe("0:00");
  });
});

describe("computeRemainingSeconds", () => {
  it("returns null when endsAt is null", () => {
    expect(computeRemainingSeconds(null, 1_000)).toBeNull();
  });

  it("rounds up the remaining time to the nearest second", () => {
    expect(computeRemainingSeconds(10_000, 8_500)).toBe(2);
  });

  it("floors at 0 once endsAt has passed", () => {
    expect(computeRemainingSeconds(10_000, 12_000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/gymOffline/liveSession.test.ts`
Expected: FAIL — `liveSession.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/gymOffline/liveSession.ts`:

```ts
// Pure helpers for deriving "what's happening in the live session right now"
// from raw cached data, extracted so they're unit-testable without React or
// a DOM (this repo has no jsdom/testing-library — see liveSession.test.ts).
// Shared by LiveSessionPanel (the full in-session view) and CompactSessionBar
// (the persistent strip shown on every /gym/* tab).
import type { CachedSession } from "./db";

// The most recently started session that hasn't been ended yet — durable
// across reloads/app kills since `sessions` is populated from IndexedDB, not
// transient React state.
export function getActiveSession(sessions: CachedSession[]): CachedSession | undefined {
  return [...sessions]
    .filter((s) => !s.endedAt)
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
}

export function formatMmSs(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// `endsAt`/`now` are both epoch-ms timestamps. Rounds up so a display tied to
// a 1s tick never flashes "0" a beat before the timer's own completion effect
// actually fires.
export function computeRemainingSeconds(endsAt: number | null, now: number): number | null {
  if (endsAt == null) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/gymOffline/liveSession.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Wire `getActiveSession` into `LiveSessionPanel`**

In `web/src/components/gym/LiveSessionPanel.tsx`, replace the inline `useMemo` derivation with the extracted helper — same behavior, now shared with `CompactSessionBar` in Task 5:

```tsx
import { useMemo, useRef } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { getActiveSession } from "@/lib/gymOffline/liveSession";
import { SessionExerciseQueue } from "./SessionExerciseQueue";
import { ActiveSessionSets } from "./ActiveSessionSets";
import { RestTimer, type RestTimerHandle } from "./RestTimer";
```

Replace:

```tsx
  const activeSession = useMemo(() => {
    return [...sessions]
      .filter((s) => !s.endedAt)
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
  }, [sessions]);
```

with:

```tsx
  const activeSession = useMemo(() => getActiveSession(sessions), [sessions]);
```

- [ ] **Step 6: Run the full test suite and lint**

Run: `cd web && npx vitest run && npm run lint`
Expected: all tests PASS, lint clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/gymOffline/liveSession.ts web/src/lib/gymOffline/liveSession.test.ts web/src/components/gym/LiveSessionPanel.tsx
git commit -m "refactor: extract getActiveSession/formatMmSs/computeRemainingSeconds as pure helpers"
```

---

### Task 2: Lift rest-timer state into `GymOfflineContext`

**Files:**
- Modify: `web/src/lib/gymOffline/context.tsx`

**Interfaces:**
- Consumes: `nextRestTimerPreset`, `readStoredRestSeconds`, `storeRestSeconds` from `web/src/lib/gymRestTimer.ts` (all pre-existing); `playRestTimerBeep` from `web/src/lib/gymRestTimerAudio.ts` (pre-existing).
- Produces: new `GymOfflineContextValue` fields consumed by Task 3 (`RestTimer.tsx`, `LiveSessionPanel.tsx`) and Task 5 (`CompactSessionBar.tsx`):
  - `restEndsAt: number | null`
  - `restPresetSeconds: number`
  - `startRestTimer(): void`
  - `stopRestTimer(): void`
  - `cycleRestPreset(): void`

There's no separate test file for this task — `GymOfflineContext` has no existing unit tests (it's a React provider wired to IndexedDB + `fetch`; the existing `queue.test.ts`/`db.test.ts` test the modules it calls into, not the provider itself). Verify this task via `npm run build` + `npm run lint` + the manual QA in Task 6, consistent with this file's existing test coverage.

- [ ] **Step 1: Add imports**

In `web/src/lib/gymOffline/context.tsx`, add to the existing import block:

```ts
import { nextRestTimerPreset, readStoredRestSeconds, storeRestSeconds } from "@/lib/gymRestTimer";
import { playRestTimerBeep } from "@/lib/gymRestTimerAudio";
```

- [ ] **Step 2: Extend the context value interface**

Add to `GymOfflineContextValue` (after `lastFlush: FlushResult | null;`):

```ts
  restEndsAt: number | null;
  restPresetSeconds: number;
  startRestTimer(): void;
  stopRestTimer(): void;
  cycleRestPreset(): void;
```

- [ ] **Step 3: Add provider state and actions**

In `GymOfflineProvider`, after the existing `lastFlush` state:

```ts
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [restPresetSeconds, setRestPresetSeconds] = useState(() => readStoredRestSeconds());

  const startRestTimer = useCallback(() => {
    setRestEndsAt(Date.now() + restPresetSeconds * 1000);
  }, [restPresetSeconds]);

  const stopRestTimer = useCallback(() => {
    setRestEndsAt(null);
  }, []);

  const cycleRestPreset = useCallback(() => {
    setRestPresetSeconds((prev) => {
      const next = nextRestTimerPreset(prev);
      storeRestSeconds(next);
      return next;
    });
  }, []);

  // Single source of truth for the completion beep: this fires exactly once
  // per countdown regardless of how many components (RestTimer,
  // CompactSessionBar) are simultaneously rendering the same restEndsAt —
  // those components are read-only display consumers, not owners of the
  // side effect.
  useEffect(() => {
    if (restEndsAt == null) return;
    const remainingMs = restEndsAt - Date.now();
    if (remainingMs <= 0) {
      setRestEndsAt(null);
      return;
    }
    const timeout = setTimeout(() => {
      playRestTimerBeep();
      setRestEndsAt(null);
    }, remainingMs);
    return () => clearTimeout(timeout);
  }, [restEndsAt]);
```

- [ ] **Step 4: Expose the new fields from the provider value**

In the `<GymOfflineContext.Provider value={{ ... }}>` object, add after `lastFlush,`:

```ts
        restEndsAt,
        restPresetSeconds,
        startRestTimer,
        stopRestTimer,
        cycleRestPreset,
```

- [ ] **Step 5: Typecheck and lint**

Run: `cd web && npx tsc --noEmit && npm run lint`
Expected: no errors (the new fields aren't consumed anywhere yet, which is fine — `RestTimer.tsx` and `LiveSessionPanel.tsx` still use their own local state/ref until Task 3, so behavior is unchanged so far).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/gymOffline/context.tsx
git commit -m "feat: lift rest-timer state into GymOfflineContext"
```

---

### Task 3: Rewire `RestTimer` and `LiveSessionPanel` onto the lifted state

**Files:**
- Modify: `web/src/components/gym/RestTimer.tsx`
- Modify: `web/src/components/gym/LiveSessionPanel.tsx`

**Interfaces:**
- Consumes: `restEndsAt`, `restPresetSeconds`, `startRestTimer`, `stopRestTimer`, `cycleRestPreset`, `computeRemainingSeconds` (from Task 1/2).
- Produces: `RestTimer` no longer takes a `ref`/exposes `RestTimerHandle` — later tasks (and any future caller) trigger the timer via `useGymOffline().startRestTimer()` directly.

- [ ] **Step 1: Rewrite `RestTimer.tsx` as a pure display component**

Replace the full contents of `web/src/components/gym/RestTimer.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { computeRemainingSeconds } from "@/lib/gymOffline/liveSession";

// Countdown display only — the actual timer state (restEndsAt) lives in
// GymOfflineContext so CompactSessionBar can show the same countdown outside
// this component's tree (see gym/layout.tsx). This component just ticks its
// own 1s re-render and renders whatever the context says. The completion
// beep fires once from the provider itself, not from here — see
// context.tsx's restEndsAt effect.
export function RestTimer() {
  const { restEndsAt, restPresetSeconds, stopRestTimer, cycleRestPreset } = useGymOffline();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (restEndsAt == null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [restEndsAt]);

  const remaining = computeRemainingSeconds(restEndsAt, now);
  const isRunning = remaining != null;

  return (
    <div className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
      <span className="text-neutral-500">Rest timer</span>
      {isRunning ? (
        <div className="flex items-center gap-3">
          <span className="font-mono text-base tabular-nums" aria-live="polite">
            {remaining}s
          </span>
          <button type="button" onClick={stopRestTimer} className="text-xs text-neutral-500 underline">
            Skip
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={cycleRestPreset}
          className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
        >
          {restPresetSeconds}s
        </button>
      )}
    </div>
  );
}
```

This removes the `RestTimerHandle` export, the `ref`/`useImperativeHandle` plumbing, `readStoredRestSeconds`/`storeRestSeconds` imports (now owned by the context), and the local `setInterval` (now the context owns the authoritative `setTimeout`; this component's `setInterval` is display-only, purely to re-render every second while `restEndsAt` is set).

- [ ] **Step 2: Update `LiveSessionPanel.tsx` to drop the ref and call context directly**

In `web/src/components/gym/LiveSessionPanel.tsx`, remove the `RestTimerHandle` import and the ref:

```tsx
import { RestTimer } from "./RestTimer";
```

(was `import { RestTimer, type RestTimerHandle } from "./RestTimer";`)

Remove:

```tsx
  const restTimerRef = useRef<RestTimerHandle>(null);
```

and its surrounding comment. Since `useRef` is no longer used anywhere else in this file, drop it from the `react` import too — change:

```tsx
import { useMemo, useRef } from "react";
```

to:

```tsx
import { useMemo } from "react";
```

Destructure `startRestTimer` from context alongside the existing fields:

```tsx
  const { sessions, sets, startSession, endSession, startRestTimer } = useGymOffline();
```

Replace the `<RestTimer ref={restTimerRef} />` render with plain `<RestTimer />`, and change:

```tsx
              onLogged={() => restTimerRef.current?.start()}
```

to:

```tsx
              onLogged={startRestTimer}
```

- [ ] **Step 3: Typecheck, lint, and run the full test suite**

Run: `cd web && npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no type errors, lint clean, all existing tests still pass (no test exercises `RestTimer` directly, so none should need updating — confirm with a grep: `grep -rl "RestTimerHandle" web/src` should return nothing after this step).

- [ ] **Step 4: Manual QA**

Run `cd web && npm run dev`, open `/gym`, start a session, log a set, confirm the rest timer counts down and the "Skip" button and preset-cycling button both still work exactly as before (this task is a pure refactor — behavior must be identical to pre-Task-2).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/gym/RestTimer.tsx web/src/components/gym/LiveSessionPanel.tsx
git commit -m "refactor: RestTimer reads/writes rest-timer state via GymOfflineContext"
```

---

### Task 4: Build `GymTabBar` and wire it into the gym layout

**Files:**
- Create: `web/src/lib/gymNav.ts`
- Test: `web/src/lib/gymNav.test.ts`
- Create: `web/src/components/gym/GymTabBar.tsx`
- Modify: `web/src/app/gym/layout.tsx`
- Modify: `web/src/app/gym/page.tsx`

**Interfaces:**
- Produces: `GYM_TABS: { href: string; label: string }[]`, `isGymTabActive(pathname: string, href: string): boolean` from `web/src/lib/gymNav.ts`, consumed by `GymTabBar.tsx`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/gymNav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GYM_TABS, isGymTabActive } from "./gymNav";

describe("GYM_TABS", () => {
  it("lists Sessions, Plan, Insights, Weight in order", () => {
    expect(GYM_TABS.map((t) => t.label)).toEqual(["Sessions", "Plan", "Insights", "Weight"]);
    expect(GYM_TABS.map((t) => t.href)).toEqual(["/gym", "/gym/plan", "/gym/insights", "/gym/bodyweight"]);
  });
});

describe("isGymTabActive", () => {
  it("matches an exact path", () => {
    expect(isGymTabActive("/gym/plan", "/gym/plan")).toBe(true);
  });

  it("matches a nested path under the tab's href", () => {
    expect(isGymTabActive("/gym/plan/edit", "/gym/plan")).toBe(true);
  });

  it("does not match a sibling tab", () => {
    expect(isGymTabActive("/gym/insights", "/gym/plan")).toBe(false);
  });

  it("does not treat /gym as active for every nested route (exact-match only for the Sessions tab)", () => {
    expect(isGymTabActive("/gym/plan", "/gym")).toBe(false);
  });

  it("matches /gym itself for the Sessions tab", () => {
    expect(isGymTabActive("/gym", "/gym")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/gymNav.test.ts`
Expected: FAIL — `gymNav.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/gymNav.ts`:

```ts
export interface GymTab {
  href: string;
  label: string;
}

export const GYM_TABS: GymTab[] = [
  { href: "/gym", label: "Sessions" },
  { href: "/gym/plan", label: "Plan" },
  { href: "/gym/insights", label: "Insights" },
  { href: "/gym/bodyweight", label: "Weight" },
];

// Same active-detection idiom as BottomNav.tsx, except the Sessions tab
// (href "/gym") is deliberately exact-match only — every other gym route
// lives under /gym/*, so a naive startsWith("/gym") would mark Sessions
// active on every tab simultaneously.
export function isGymTabActive(pathname: string, href: string): boolean {
  if (href === "/gym") return pathname === "/gym";
  return pathname === href || pathname.startsWith(`${href}/`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/gymNav.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Build `GymTabBar`**

Create `web/src/components/gym/GymTabBar.tsx`:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GYM_TABS, isGymTabActive } from "@/lib/gymNav";

// Secondary nav, one level down from BottomNav — text-only underline tabs
// (not icon pills) so the two layers stay visually distinct while sharing
// the same violet-600 accent color.
export function GymTabBar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Gym sections" className="mb-4 flex border-b border-neutral-200 dark:border-neutral-800">
      {GYM_TABS.map((tab) => {
        const active = isGymTabActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex-1 border-b-2 py-2 text-center text-sm font-medium transition-colors ${
              active
                ? "border-violet-600 text-violet-600 dark:text-violet-400"
                : "border-transparent text-neutral-500 dark:text-neutral-400"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: Wire `GymTabBar` into the gym layout**

In `web/src/app/gym/layout.tsx`, add the import:

```tsx
import { GymTabBar } from "@/components/gym/GymTabBar";
```

Render it right after `GymStatusHeader`'s wrapping div and before the `ViewTransition`:

```tsx
          <div style={{ viewTransitionName: "site-header" }}>
            <GymStatusHeader />
          </div>
          <GymTabBar />
          <ViewTransition name="tab-content" share="tab-crossfade" enter="suspense-reveal" default="none">
            {children}
          </ViewTransition>
```

- [ ] **Step 7: Remove the old link row from `gym/page.tsx`**

In `web/src/app/gym/page.tsx`, drop the `Link` import and the now-redundant links (the tab bar replaces them), keeping the "Recent sessions" heading:

```tsx
import { LiveSessionPanel } from "@/components/gym/LiveSessionPanel";
import { GymHistoryList } from "@/components/gym/GymHistoryList";

// No data fetch here on purpose — see gym/layout.tsx's header comment. All
// dynamic content is client-fetched via GymOfflineProvider so this shell
// stays static/precacheable for offline cold-launch reachability.
export default function GymPage() {
  return (
    <div>
      <LiveSessionPanel />

      <div className="mt-6">
        <h2 className="text-sm font-medium">Recent sessions</h2>
        <GymHistoryList />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Typecheck, lint, and run the full test suite**

Run: `cd web && npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no errors, all tests pass.

- [ ] **Step 9: Manual QA**

Run `cd web && npm run dev`, open `/gym` and click through all four tabs — confirm each shows the correct active-tab styling (violet underline) and no other tab is highlighted; confirm the old text links are gone from the page body.

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/gymNav.ts web/src/lib/gymNav.test.ts web/src/components/gym/GymTabBar.tsx web/src/app/gym/layout.tsx web/src/app/gym/page.tsx
git commit -m "feat: add GymTabBar, replace ad-hoc Plan/Insights/Weight links"
```

---

### Task 5: Build `CompactSessionBar` and wire it into the gym layout

**Files:**
- Create: `web/src/components/gym/CompactSessionBar.tsx`
- Modify: `web/src/app/gym/layout.tsx`

**Interfaces:**
- Consumes: `getActiveSession`, `formatMmSs`, `computeRemainingSeconds` (Task 1); `sessions`, `sets`, `restEndsAt` from `useGymOffline()` (Task 2).

No new pure-logic file here — this component only composes helpers already tested in Task 1, so per this repo's convention it's verified via build/lint + manual QA rather than a new test file (there's nothing new here that isn't either already-tested pure logic or React rendering).

- [ ] **Step 1: Build `CompactSessionBar`**

Create `web/src/components/gym/CompactSessionBar.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useGymOffline } from "@/lib/gymOffline/context";
import { computeRemainingSeconds, formatMmSs, getActiveSession } from "@/lib/gymOffline/liveSession";

function weekdayNameFor(sessionDate: string): string {
  return new Date(`${sessionDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
}

// Always-visible summary of the in-progress session, shown on every /gym/*
// tab (rendered once in gym/layout.tsx) so stepping onto Plan/Insights/Weight
// mid-workout doesn't lose sight of it. Tapping it navigates to the Sessions
// tab, where the full LiveSessionPanel (timer, queue, set-logging) lives —
// there's no separate expand/collapse state, "expanding" just means
// navigating there.
export function CompactSessionBar() {
  const { sessions, sets, restEndsAt } = useGymOffline();
  const [now, setNow] = useState(() => Date.now());

  const activeSession = useMemo(() => getActiveSession(sessions), [sessions]);
  const activeSetCount = useMemo(() => {
    if (!activeSession) return 0;
    return sets.filter((s) => s.sessionClientUuid === activeSession.clientUuid).length;
  }, [sets, activeSession]);

  useEffect(() => {
    if (!activeSession) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeSession]);

  if (!activeSession) return null;

  const restRemaining = computeRemainingSeconds(restEndsAt, now);
  const startedAtMs = activeSession.startedAt ? new Date(activeSession.startedAt).getTime() : now;
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAtMs) / 1000));

  const timeLabel = restRemaining != null ? `${formatMmSs(restRemaining)} rest` : formatMmSs(elapsedSeconds);

  return (
    <Link
      href="/gym"
      className="mb-3 flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs
                 dark:border-violet-900 dark:bg-violet-950/30"
    >
      <span className="flex items-center gap-2 font-medium text-violet-700 dark:text-violet-300">
        <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
        {weekdayNameFor(activeSession.sessionDate)} session
      </span>
      <span className="flex items-center gap-3 text-violet-700 dark:text-violet-300">
        <span className="font-mono tabular-nums">{timeLabel}</span>
        <span>{activeSetCount} sets</span>
        <span aria-hidden="true">&rsaquo;</span>
      </span>
    </Link>
  );
}
```

- [ ] **Step 2: Wire `CompactSessionBar` into the gym layout**

In `web/src/app/gym/layout.tsx`, add the import:

```tsx
import { CompactSessionBar } from "@/components/gym/CompactSessionBar";
```

Render it between `GymStatusHeader` and `GymTabBar`:

```tsx
          <div style={{ viewTransitionName: "site-header" }}>
            <GymStatusHeader />
          </div>
          <CompactSessionBar />
          <GymTabBar />
```

- [ ] **Step 3: Typecheck, lint, and run the full test suite**

Run: `cd web && npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no errors, all tests pass.

- [ ] **Step 4: Manual QA**

Run `cd web && npm run dev`:
1. With no active session, confirm nothing renders between the header and the tab bar.
2. Start a session on `/gym`, confirm the compact bar appears showing "{Weekday} session", elapsed time ticking up, and "0 sets".
3. Log a set, confirm the sets count increments and the compact bar switches to showing the rest countdown ("`0:XX` rest") instead of elapsed time while resting, then falls back to elapsed time once the rest period ends.
4. Navigate to Plan, Insights, and Weight tabs — confirm the compact bar (and its ticking countdown/elapsed time) stays visible and correct on all of them.
5. Tap the compact bar from a non-Sessions tab, confirm it navigates to `/gym`.
6. End the session, confirm the compact bar disappears immediately.
7. Toggle offline in devtools (Network tab), confirm the compact bar still renders and ticks correctly from cached data.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/gym/CompactSessionBar.tsx web/src/app/gym/layout.tsx
git commit -m "feat: add CompactSessionBar, pinned live-session summary across gym tabs"
```

---

### Task 6: Final verification and push

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `cd web && npm run build`
Expected: production build succeeds with no type or lint errors.

- [ ] **Step 2: Full test suite**

Run: `cd web && npx vitest run`
Expected: all tests pass, including the new `liveSession.test.ts` and `gymNav.test.ts`.

- [ ] **Step 3: End-to-end manual QA pass**

Repeat the full flow from Task 5 Step 4 once more against the production build (`npm run start` after `npm run build`), on a mobile-width viewport, to confirm nothing regressed once everything (tab bar + compact bar + lifted rest timer) is combined.

- [ ] **Step 4: Push**

```bash
git push
```
