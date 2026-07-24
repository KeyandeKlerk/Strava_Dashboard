# PWA Design Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 12 recommendations from the PWA design review (`/home/keyan/.claude/plans/shiny-plotting-gray.md`) so the installed dashboard feels like a native app rather than a bookmarked website, without touching the gym offline-sync architecture, the chart design system, or any data/schema layer.

**Architecture:** Every task here is a UI/asset/config change — no schema, mutation, or offline-queue changes anywhere in this plan. Two small shared modules get created early (a style-constants module and a nav-icons module) that later tasks build on; everything else is independent and can be done in any order after those two land.

**Tech Stack:** Next.js App Router (v16.2.10), Tailwind CSS v4 (CSS-first config, no `tailwind.config.*`), Serwist v9.5.11 for the service worker, no new npm dependencies anywhere in this plan.

## Global Constraints

- No new npm dependencies (icons are hand-written inline SVGs, not a library).
- No changes to `web/src/lib/gymOffline/`, `web/src/lib/db/`, `web/src/lib/gymMutations.ts`/`gymActions.ts`, or any schema/migration file — this plan is UI/PWA-shell only.
- This codebase's established test convention (confirmed across every prior gym plan) is: automated unit tests only for pure/logic-layer code; no tests for React components, pages, or layouts. Every task below is UI/config, so verification is `tsc --noEmit` + `npm run build` + manual/on-device checks, not new test files — except Task 1, which touches a genuinely pure exported constant and follows the same convention (no test needed for a plain string constant, consistent with how `FIELD_CLASS` itself was never tested before).
- Primary device is iPhone Safari, PWA installed to home screen (`display: "standalone"`) — every visual change must work with `prefers-color-scheme: dark` (this app has no manual theme toggle, dark mode is OS-driven) and must not regress `env(safe-area-inset-bottom)` handling already in `BottomNav.tsx`.
- Follow existing conventions exactly: Tailwind utility classes inline (no CSS modules/styled-components), `"use client"` only on components that need interactivity/hooks, empty/error-state phrasing matches the existing `text-sm text-neutral-500` convention seen throughout the app.

---

### Task 1: Shared UI style constants — dedupe `FIELD_CLASS`, add `TAP_TARGET_CLASS`

**Files:**
- Create: `web/src/lib/uiStyles.ts`
- Modify: `web/src/components/NutritionSection.tsx:9`, `web/src/components/EditSessionSheet.tsx:10`, `web/src/components/WorkoutDetailSheet.tsx:29`, `web/src/components/LogFuelingSheet.tsx:6`, `web/src/components/gym/SetEntryForm.tsx:9`, `web/src/components/gym/PlanBuilder.tsx:15`, `web/src/components/gym/BodyWeightPage.tsx:9`, `web/src/components/gym/ExercisePicker.tsx:7`, `web/src/components/gym/GymSessionDetailSheet.tsx:16`, `web/src/components/gym/ExerciseProgressionSection.tsx:9` (each has an identical local `const FIELD_CLASS = "..."` declaration to remove)

**Interfaces:**
- Produces: `FIELD_CLASS: string`, `TAP_TARGET_CLASS: string` — consumed by Task 2 (`TAP_TARGET_CLASS`) and by every file in the Modify list above (`FIELD_CLASS`).

- [ ] **Step 1: Create the shared module**

Create `web/src/lib/uiStyles.ts`:
```ts
// Shared Tailwind class strings, extracted so they can't silently drift
// across the 10+ files that used to hand-copy them independently.

export const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

// Expands an inline text/icon button's tappable area toward Apple HIG's
// ~44pt minimum without changing its visual size: the padding grows the hit
// area, the matching negative margin pulls the visible box back to its
// original position, so surrounding layout/spacing is unaffected. Apply
// alongside a button's existing text/color classes, e.g.
// `className={`text-xs text-red-600 ${TAP_TARGET_CLASS}`}`.
export const TAP_TARGET_CLASS = "inline-flex items-center justify-center p-2 -m-2";
```

- [ ] **Step 2: Repoint every `FIELD_CLASS` declaration to the shared module**

In each of the 10 files listed above, delete the local declaration (it's always these exact two lines, verified identical across every file):
```ts
const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";
```
and add this import alongside the file's other imports:
```ts
import { FIELD_CLASS } from "@/lib/uiStyles";
```
Two fully worked examples (apply the identical recipe to the other 8 files):

`web/src/components/gym/SetEntryForm.tsx` — before (lines 1-8):
```tsx
"use client";
import { useState } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { useWeightUnit } from "@/lib/gymOffline/useWeightUnit";
import { calculatePlates, DEFAULT_BAR_KG, DEFAULT_BAR_LB } from "@/lib/plateCalculator";
import type { CachedExercise } from "@/lib/gymOffline/db";

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";
```
after:
```tsx
"use client";
import { useState } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { useWeightUnit } from "@/lib/gymOffline/useWeightUnit";
import { calculatePlates, DEFAULT_BAR_KG, DEFAULT_BAR_LB } from "@/lib/plateCalculator";
import { FIELD_CLASS } from "@/lib/uiStyles";
import type { CachedExercise } from "@/lib/gymOffline/db";
```
(If the exact import list differs slightly from what's above by the time you're editing — later tasks in this plan and other work may have touched this file — just delete the two-line `const FIELD_CLASS` declaration and add the `import { FIELD_CLASS } from "@/lib/uiStyles";` line among the other imports; the recipe is the same regardless.)

`web/src/components/gym/PlanBuilder.tsx` — before (lines 1-16):
```tsx
"use client";
import { useState } from "react";
import { addCustomExerciseAction, setPlanForDayAction } from "@/lib/gymActions";
import { MUSCLE_GROUPS } from "@/lib/db/gymExerciseSeed";
import { buildPlanItems, flattenPlanItems, isContiguousSelection, normalizeGroups } from "@/lib/gymSupersets";
import type { GymExerciseRow, PlanEntryInput, PlanExerciseRow } from "@/lib/db/gymMutations";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";
```
after:
```tsx
"use client";
import { useState } from "react";
import { addCustomExerciseAction, setPlanForDayAction } from "@/lib/gymActions";
import { MUSCLE_GROUPS } from "@/lib/db/gymExerciseSeed";
import { buildPlanItems, flattenPlanItems, isContiguousSelection, normalizeGroups } from "@/lib/gymSupersets";
import { FIELD_CLASS } from "@/lib/uiStyles";
import type { GymExerciseRow, PlanEntryInput, PlanExerciseRow } from "@/lib/db/gymMutations";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
```
(Note `PlanBuilder.tsx`'s exact current line numbers may have shifted since the superset-grouping work landed — search for `const FIELD_CLASS` in the file rather than trusting a specific line number.)

Apply the identical two-part edit (delete local declaration, add import) to the remaining 8 files: `NutritionSection.tsx`, `EditSessionSheet.tsx`, `WorkoutDetailSheet.tsx`, `LogFuelingSheet.tsx`, `BodyWeightPage.tsx`, `ExercisePicker.tsx`, `GymSessionDetailSheet.tsx`, `ExerciseProgressionSection.tsx`.

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: no errors (a leftover unused-import or a missed declaration would show up as a TS error here).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/uiStyles.ts web/src/components/NutritionSection.tsx web/src/components/EditSessionSheet.tsx web/src/components/WorkoutDetailSheet.tsx web/src/components/LogFuelingSheet.tsx web/src/components/gym/SetEntryForm.tsx web/src/components/gym/PlanBuilder.tsx web/src/components/gym/BodyWeightPage.tsx web/src/components/gym/ExercisePicker.tsx web/src/components/gym/GymSessionDetailSheet.tsx web/src/components/gym/ExerciseProgressionSection.tsx
git commit -m "refactor: extract shared FIELD_CLASS/TAP_TARGET_CLASS constants"
```

---

### Task 2: Fix undersized tap targets in the gym plan builder and active-session view

**Files:**
- Modify: `web/src/components/gym/PlanBuilder.tsx` (search for the buttons described below — exact line numbers may have shifted)
- Modify: `web/src/components/gym/ActiveSessionSets.tsx`

**Interfaces:**
- Consumes: `TAP_TARGET_CLASS` from `web/src/lib/uiStyles.ts` (Task 1).

- [ ] **Step 1: `PlanBuilder.tsx` — apply `TAP_TARGET_CLASS` to every undersized/unstyled small button**

Add the import:
```tsx
import { FIELD_CLASS, TAP_TARGET_CLASS } from "@/lib/uiStyles";
```
(This replaces the plain `import { FIELD_CLASS } from "@/lib/uiStyles";` from Task 1 with both names in one import.)

Find and update each of these five buttons (search by their current text/glyph — exact surrounding line numbers may have moved since the superset-grouping task landed):

"Cancel" button — before:
```tsx
      <button type="button" onClick={onCancel} className="mt-2 text-xs text-neutral-500">
        Cancel
      </button>
```
after:
```tsx
      <button type="button" onClick={onCancel} className={`mt-2 text-xs text-neutral-500 ${TAP_TARGET_CLASS}`}>
        Cancel
      </button>
```

"Remove" (member row) — before:
```tsx
            <button type="button" onClick={() => removeExercise(index)} className="text-red-600">
              Remove
            </button>
```
after:
```tsx
            <button type="button" onClick={() => removeExercise(index)} className={`text-red-600 ${TAP_TARGET_CLASS}`}>
              Remove
            </button>
```

"Clear" button — before:
```tsx
            <button type="button" onClick={() => setSelectedIds(new Set())} className="text-neutral-500">
              Clear
            </button>
```
after:
```tsx
            <button type="button" onClick={() => setSelectedIds(new Set())} className={`text-neutral-500 ${TAP_TARGET_CLASS}`}>
              Clear
            </button>
```

↑/↓ reorder buttons (currently have **no** `className` at all) — before:
```tsx
              <button type="button" onClick={() => moveItem(itemIndex, -1)} disabled={itemIndex === 0}>
                ↑
              </button>
              <button type="button" onClick={() => moveItem(itemIndex, 1)} disabled={itemIndex === items.length - 1}>
                ↓
              </button>
```
after:
```tsx
              <button
                type="button"
                onClick={() => moveItem(itemIndex, -1)}
                disabled={itemIndex === 0}
                className={`text-neutral-500 disabled:opacity-30 dark:text-neutral-400 ${TAP_TARGET_CLASS}`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveItem(itemIndex, 1)}
                disabled={itemIndex === items.length - 1}
                className={`text-neutral-500 disabled:opacity-30 dark:text-neutral-400 ${TAP_TARGET_CLASS}`}
              >
                ↓
              </button>
```

"Ungroup" button — before:
```tsx
                  <button
                    type="button"
                    onClick={() => ungroupGroup(item.groupId)}
                    className="text-violet-600 dark:text-violet-400"
                  >
                    Ungroup
                  </button>
```
after:
```tsx
                  <button
                    type="button"
                    onClick={() => ungroupGroup(item.groupId)}
                    className={`text-violet-600 dark:text-violet-400 ${TAP_TARGET_CLASS}`}
                  >
                    Ungroup
                  </button>
```

- [ ] **Step 2: `ActiveSessionSets.tsx` — apply the same treatment to "Remove"**

Add the import (or extend the existing `uiStyles` import if `FIELD_CLASS` is already imported here — check first):
```tsx
import { TAP_TARGET_CLASS } from "@/lib/uiStyles";
```
Before:
```tsx
                  <button type="button" onClick={() => deleteSet(set.clientUuid)} className="text-xs text-red-600">
                    Remove
                  </button>
```
After:
```tsx
                  <button type="button" onClick={() => deleteSet(set.clientUuid)} className={`text-xs text-red-600 ${TAP_TARGET_CLASS}`}>
                    Remove
                  </button>
```

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

Manual check (`cd web && npm run dev`, open `/gym/plan`): confirm the ↑/↓ arrows, Remove, Cancel, Clear, and Ungroup buttons all still look visually identical (same size/position) but now have a noticeably larger invisible tap area around them — tap near (not exactly on) each glyph/label and confirm it still registers.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/gym/PlanBuilder.tsx web/src/components/gym/ActiveSessionSets.tsx
git commit -m "fix: expand tap targets on small gym plan/session buttons"
```

---

### Task 3: Hand-rolled nav icons

**Files:**
- Create: `web/src/components/icons/NavIcons.tsx`
- Modify: `web/src/components/BottomNav.tsx`

**Interfaces:**
- Produces: `NAV_ICONS: Record<string, (props: { className?: string }) => React.ReactNode>` — consumed by Task 4 (which also edits `BottomNav.tsx`; do Task 3 first since Task 4's edit touches the same render block).

- [ ] **Step 1: Create the icon set**

Create `web/src/components/icons/NavIcons.tsx`:
```tsx
// Minimal hand-rolled line icons for the bottom tab bar — no icon library
// dependency. Each icon is 24x24 viewBox, stroke-based, uses `currentColor`
// so the existing active/inactive text-color classes on the tab button
// control the icon's color automatically.
type IconProps = { className?: string };

const BASE = "none";
const STROKE_PROPS = {
  fill: BASE,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function TodayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <rect x="3.75" y="5.25" width="16.5" height="15" rx="2" />
      <path d="M3.75 9.75h16.5" />
      <path d="M8 3v3M16 3v3" />
    </svg>
  );
}

export function FatigueIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </svg>
  );
}

export function LoadIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M5 19V10M12 19V5M19 19v-6" />
    </svg>
  );
}

export function AerobicIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M3 9h11a3 3 0 1 0-2.5-4.7" />
      <path d="M3 15h14a3 3 0 1 1-2.5 4.7" />
    </svg>
  );
}

export function RaceIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 3.5L16 11H5" />
    </svg>
  );
}

export function HistoryIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M3.5 8a8.5 8.5 0 1 1-1 5" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

export function GymIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE_PROPS} aria-hidden="true">
      <path d="M6 7v10M18 7v10" />
      <path d="M3.5 9.5v5M20.5 9.5v5" />
      <path d="M6 12h12" />
    </svg>
  );
}

// Keyed by NavItem.href (web/src/lib/nav.ts) so BottomNav can do a plain
// lookup without a switch statement.
export const NAV_ICONS: Record<string, (props: IconProps) => React.ReactNode> = {
  "/today": TodayIcon,
  "/fatigue": FatigueIcon,
  "/training-load": LoadIcon,
  "/aerobic": AerobicIcon,
  "/race-prep": RaceIcon,
  "/plan-history": HistoryIcon,
  "/gym": GymIcon,
};
```

- [ ] **Step 2: Verify the module compiles standalone**

Run: `cd web && npx tsc --noEmit`
Expected: no errors (this file isn't imported anywhere yet, so this just checks the new file's own syntax/types).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/icons/NavIcons.tsx
git commit -m "feat: add hand-rolled bottom-nav icon set"
```

(`BottomNav.tsx` is wired up to actually render these in Task 4, alongside the `next/link` switch, since both edits touch the same JSX block.)

---

### Task 4: Bottom nav + gym cross-links use `next/link`, and render icons

**Files:**
- Modify: `web/src/components/BottomNav.tsx`
- Modify: `web/src/app/gym/page.tsx` (the "Plan"/"Insights"/"Body weight" links — check current text, may say "Weight" per the recent body-weight task)

**Interfaces:**
- Consumes: `NAV_ICONS` (Task 3).

**Why this is safe despite the existing comment's caution:** `web/src/components/BottomNav.tsx:5-7` and `web/src/app/gym/layout.tsx:4-11` both reason that plain `<a>` full-page GETs behave more predictably offline than `next/link`'s client-side RSC-payload fetches. Checked directly against the built service worker (`grep -o '"/[^"]*gym[^"]*"' web/public/sw.js` after a production build): `/gym` is **not** in the precache manifest at all — meaning today, a fully-cold offline navigation to `/gym` (never visited before) already fails identically whether it's a full-page GET or a client transition, since neither has anything to fall back to. The actual protection that exists today is Serwist's runtime NetworkFirst caching (`defaultCache` from `@serwist/next/worker`, `web/src/app/sw.ts:26`) kicking in *after* a page has been visited at least once online — and that same runtime-caching rule applies to Next.js's RSC/flight payload fetches too, not just full-document requests, since `@serwist/next`'s preset is specifically built to handle Next.js's client-router request shape. So switching to `next/link` doesn't remove any real offline guarantee that exists today; it just makes online (and previously-visited-offline) navigation instant instead of a full reload. Verify this holds with the on-device check in Step 4 below before considering this task done — if that check reveals a real regression, stop and escalate rather than pushing through.

- [ ] **Step 1: Update `BottomNav.tsx`**

Replace the file's header comment and render, adding icons and switching to `next/link`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";
import { NAV_ICONS } from "./icons/NavIcons";

// Client-side <Link> transitions, not full-page <a> reloads: Serwist's
// Next.js-aware runtime caching (`defaultCache`, see src/app/sw.ts) applies
// the same NetworkFirst policy to RSC/flight-payload fetches as it does to
// full document requests, so a page that's been visited at least once
// online is equally available offline either way — switching to <Link>
// only removes the full-page-reload flash on every tab switch, it doesn't
// remove any offline guarantee that existed before (see this task's plan
// entry for the empirical check that established this).
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-neutral-200 bg-white/95 backdrop-blur
                 pb-[env(safe-area-inset-bottom)] dark:border-neutral-800 dark:bg-neutral-950/95"
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-3xl gap-1.5 px-2 py-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = NAV_ICONS[item.href];
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 text-xs font-medium transition-colors ${
                  active
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-900"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {Icon && <Icon className="h-5 w-5" />}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```
(Layout note: switching from a single centered label to a stacked icon+label changes `py-3`→`py-2` and `text-sm`→`text-xs` to keep the tab height reasonable with two lines of content — verify this looks right on-device in Step 4 and adjust spacing if it feels cramped.)

- [ ] **Step 2: Update `/gym`'s cross-links to `next/link`**

In `web/src/app/gym/page.tsx`, add the import:
```tsx
import Link from "next/link";
```
Replace each of the three (or however many currently exist — check the file, a "Weight" link to `/gym/bodyweight` may already be present from the body-weight tracking task) `<a href="...">...</a>` cross-links with the same text/classes but `<Link href="...">...</Link>` instead — e.g.:
```tsx
            <a href="/gym/plan" className="text-xs text-neutral-500 underline">
              Plan
            </a>
```
becomes:
```tsx
            <Link href="/gym/plan" className="text-xs text-neutral-500 underline">
              Plan
            </Link>
```
Apply the same `<a` → `<Link` / `</a>` → `</Link>` swap to every other internal link in this file (Insights, Body weight/Weight, and any others present).

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual + on-device verification (do not skip)**

`cd web && npm run build && npm start` (production build, since dev mode doesn't reflect the real service worker). On a real device or Safari with the PWA installed:
1. Tap through all 7 bottom-nav tabs — confirm no full white-flash reload, transitions feel instant.
2. Visit `/gym`, then background the app, put the phone in airplane mode, reopen the app, tap "Gym" again — confirm it still loads (previously-visited-offline case).
3. While still offline, tap over to a previously-visited dashboard tab (e.g. Today) — confirm it behaves the same as it did before this change (this app's dashboard pages are expected to require a network per `sw.ts`'s own "always fetch fresh" design — this check confirms that expectation didn't change, not that offline dashboard access now works).
4. Re-enable network, confirm normal navigation resumes.

If step 2 regresses (previously-working offline gym access now fails), stop and report — do not proceed to the next task with this unresolved.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/BottomNav.tsx web/src/app/gym/page.tsx
git commit -m "feat: switch nav to client-side transitions and add tab icons"
```

---

### Task 5: Back-links on gym subpages

**Files:**
- Modify: `web/src/app/gym/plan/page.tsx`, `web/src/app/gym/insights/page.tsx`, `web/src/app/gym/bodyweight/page.tsx`

**Interfaces:**
- None new — uses `next/link`.

- [ ] **Step 1: Add a "← Gym" back-link above the `<h1>` on each of the three subpages**

Add the import to each file:
```tsx
import Link from "next/link";
```
Then, immediately before each page's `<h1>`, add:
```tsx
      <Link href="/gym" className="text-xs text-neutral-500 underline">
        ← Gym
      </Link>
```
Worked example for `web/src/app/gym/plan/page.tsx` — before:
```tsx
  return (
    <div>
      <h1 className="text-lg font-semibold">Weekly Gym Plan</h1>
```
after:
```tsx
  return (
    <div>
      <Link href="/gym" className="text-xs text-neutral-500 underline">
        ← Gym
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Weekly Gym Plan</h1>
```
(Added `mt-1` to the `<h1>` for a small gap under the new back-link — check the rendered spacing and adjust if it looks cramped or too loose.)

Apply the identical pattern to `web/src/app/gym/insights/page.tsx` (its `<h1>` is inside a `<div className="space-y-6">` — the back-link goes as the first child, before the `<h1>`, and the outer `space-y-6` already handles spacing so no `mt-1` is needed there) and `web/src/app/gym/bodyweight/page.tsx` (same shape as the plan page).

- [ ] **Step 2: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

Manual check (`npm run dev`): visit each of the three subpages directly (not via `/gym`) and confirm the back-link is present, styled consistently, and actually navigates to `/gym`.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/gym/plan/page.tsx web/src/app/gym/insights/page.tsx web/src/app/gym/bodyweight/page.tsx
git commit -m "feat: add back-link to Gym on all gym subpages"
```

---

### Task 6: Gym layout header — relocate the weight-unit toggle, add an offline/pending status badge

**Files:**
- Create: `web/src/components/gym/GymStatusHeader.tsx`
- Modify: `web/src/app/gym/layout.tsx`
- Modify: `web/src/components/gym/LiveSessionPanel.tsx` (remove the now-duplicated `WeightUnitToggle`/status badges from its own header row, since they move up to the shared layout)

**Interfaces:**
- Consumes: `useGymOffline()` (`isOnline`, `pendingCount` — exact field names confirmed on `GymOfflineContextValue`), `WeightUnitToggle` (`web/src/components/gym/WeightUnitToggle.tsx`, unchanged).
- Produces: `<GymStatusHeader />` — a small client component rendered once per `/gym/*` page load, replacing the per-page-inconsistent placement of the unit toggle.

**Why this shape:** `WeightUnitToggle` currently only renders inside `LiveSessionPanel`'s header (`web/src/components/gym/LiveSessionPanel.tsx:44-50`), i.e. only visible on `/gym` while the live-session panel is in view — not on `/gym/insights`, `/gym/bodyweight`, or `/gym/plan`, all of which also show weights. `useGymOffline()` needs a `GymOfflineProvider` ancestor, which already wraps `{children}` in `web/src/app/gym/layout.tsx:16` — so `GymStatusHeader` needs to render *inside* that provider, not in the layout's outer static wrapper. Restructure the layout so a persistent header sits inside the provider, above `{children}`.

- [ ] **Step 1: Create `GymStatusHeader`**

Create `web/src/components/gym/GymStatusHeader.tsx`:
```tsx
"use client";
import { useGymOffline } from "@/lib/gymOffline/context";
import { WeightUnitToggle } from "./WeightUnitToggle";

// Persistent across all /gym/* pages (rendered once in gym/layout.tsx,
// inside GymOfflineProvider) — previously WeightUnitToggle only appeared on
// /gym itself, mid-session, so switching units required navigating back to
// the live session view even though Insights/Body Weight/Plan all display
// weights too. The online/pending indicator is this module's gym-specific
// equivalent of the dashboard layout's "Last synced ..." strip
// (web/src/app/(dashboard)/layout.tsx) — gym data is offline-first via
// IndexedDB rather than server-fetched, so "last synced" doesn't apply the
// same way, but the user still deserves a persistent freshness signal.
export function GymStatusHeader() {
  const { isOnline, pendingCount } = useGymOffline();

  return (
    <div className="mb-3 flex items-center justify-between text-xs text-neutral-400">
      <span>
        {!isOnline ? (
          <span className="text-amber-600">Offline</span>
        ) : pendingCount > 0 ? (
          <span>{pendingCount} pending sync</span>
        ) : (
          <span>Synced</span>
        )}
      </span>
      <WeightUnitToggle />
    </div>
  );
}
```

- [ ] **Step 2: Render it in `gym/layout.tsx`, inside the provider**

Before:
```tsx
import { BottomNav } from "@/components/BottomNav";
import { GymOfflineProvider } from "@/lib/gymOffline/context";

export default function GymLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4">
        <GymOfflineProvider>{children}</GymOfflineProvider>
      </main>
      <BottomNav />
    </div>
  );
}
```
After:
```tsx
import { BottomNav } from "@/components/BottomNav";
import { GymOfflineProvider } from "@/lib/gymOffline/context";
import { GymStatusHeader } from "@/components/gym/GymStatusHeader";

export default function GymLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4">
        <GymOfflineProvider>
          <GymStatusHeader />
          {children}
        </GymOfflineProvider>
      </main>
      <BottomNav />
    </div>
  );
}
```
(Keep the file's existing header comment about why this layout is static/not-force-dynamic — that reasoning is unaffected by this change, `GymStatusHeader` is a client component that reads client-side IndexedDB state, it doesn't add a server data fetch.)

- [ ] **Step 3: Remove the now-duplicated toggle/badges from `LiveSessionPanel.tsx`**

Before (`LiveSessionPanel.tsx`'s header row):
```tsx
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Gym</h2>
        <div className="flex items-center gap-2">
          {!isOnline && <span className="text-xs text-amber-600">Offline</span>}
          {pendingCount > 0 && <span className="text-xs text-neutral-500">{pendingCount} pending sync</span>}
          <WeightUnitToggle />
        </div>
      </div>
```
After:
```tsx
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Gym</h2>
      </div>
```
Remove the now-unused `import { WeightUnitToggle } from "./WeightUnitToggle";` line. Check whether `isOnline`/`pendingCount` are still used elsewhere in this file (e.g. to gate other UI) before removing them from the `useGymOffline()` destructure at the top of the component — if they're no longer referenced anywhere in the file, remove them from the destructure too so `tsc`/lint don't flag unused variables.

- [ ] **Step 4: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: no errors (this step will catch it if `isOnline`/`pendingCount` are still referenced elsewhere in `LiveSessionPanel.tsx` and were incorrectly removed from the destructure).

Manual check (`npm run dev`): visit `/gym/insights`, `/gym/bodyweight`, `/gym/plan` — confirm the kg/lb toggle and a status indicator now appear at the top of all three (previously absent), and `/gym` itself still shows them without duplication.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/gym/GymStatusHeader.tsx web/src/app/gym/layout.tsx web/src/components/gym/LiveSessionPanel.tsx
git commit -m "feat: persistent gym status header with relocated weight-unit toggle"
```

---

### Task 7: App icon polish (apple-touch-icon, maskable manifest entry)

**Files:**
- Modify: `web/src/app/layout.tsx`
- Modify: `web/src/app/manifest.ts`

**Scope note (read before starting):** A fully custom splash screen (`apple-touch-startup-image`) needs real per-device-size artwork generated from source design files, which isn't achievable without an image-generation/editing tool or a supplied source asset — that part of the original recommendation is **out of scope for this task** and is not attempted here. What *is* achievable without new artwork: pointing iOS at the existing 512×512 icon for its home-screen touch-icon (rather than nothing, which is the current state), and adding a `maskable` manifest entry reusing the same existing asset (imperfect — the source art's content sits close to its own baked-in rounded corners with no extra safe-zone padding, so an OS-applied circle mask may crop the outer ring/text slightly — but still strictly better than no maskable variant at all, which forces browsers to letterbox/pad the icon themselves instead).

- [ ] **Step 1: Add `apple-touch-icon` via the Next.js metadata API**

In `web/src/app/layout.tsx`, extend the existing `metadata` export:
```tsx
export const metadata: Metadata = {
  title: "Strava Training Dashboard",
  description: "Personal training/fatigue dashboard synced from Strava",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Training",
  },
  icons: {
    apple: "/icon-512.png",
  },
};
```

- [ ] **Step 2: Add a maskable icon entry to the manifest**

In `web/src/app/manifest.ts`, extend the `icons` array:
```ts
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
```

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: both succeed. Open `/manifest.webmanifest` in a browser after `npm start` and confirm the third icon entry with `"purpose":"maskable"` is present.

Manual check (real device, if convenient): re-add the PWA to the home screen (removing and re-adding forces iOS to re-read the manifest/icon) and confirm the home-screen icon no longer looks like a generic default — note in your own follow-up whether the existing art's tight corners look acceptable masked, since that's a judgment call this task can't fully resolve without new artwork.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/layout.tsx web/src/app/manifest.ts
git commit -m "feat: add apple-touch-icon and maskable manifest icon entry"
```

---

### Task 8: Loading skeleton component

**Files:**
- Create: `web/src/components/LoadingSpinner.tsx`
- Modify: `web/src/components/gym/GymSessionDetailSheet.tsx`, `web/src/components/WorkoutDetailSheet.tsx`

**Interfaces:**
- Produces: `<LoadingSpinner label="..."/>` — consumed by both modified files.

- [ ] **Step 1: Create the component**

Create `web/src/components/LoadingSpinner.tsx`:
```tsx
// Small shared loading indicator — replaces plain "Loading..." text in the
// two sheet components that show it. Pure CSS spin, no new dependency.
export function LoadingSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-500 dark:border-neutral-700 dark:border-t-neutral-400"
      />
      <span>{label}...</span>
    </div>
  );
}
```

- [ ] **Step 2: Swap it into both sheets**

In `web/src/components/gym/GymSessionDetailSheet.tsx`, add the import and replace:
```tsx
        {detail === undefined && <p className="text-sm text-neutral-500">Loading...</p>}
```
with:
```tsx
        {detail === undefined && <LoadingSpinner />}
```

In `web/src/components/WorkoutDetailSheet.tsx`, add the import and replace the identical line the same way.

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

Manual check (`npm run dev`): open a session detail sheet on a slow connection (throttle in devtools) and confirm the spinner renders instead of plain text.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/LoadingSpinner.tsx web/src/components/gym/GymSessionDetailSheet.tsx web/src/components/WorkoutDetailSheet.tsx
git commit -m "feat: add loading spinner, replace plain 'Loading...' text"
```

---

### Task 9: Bottom nav active-tab accent color

**Files:**
- Modify: `web/src/components/BottomNav.tsx`

**Scope note:** Deliberately minimal — this plan does not repaint every primary button in the app (that's a much larger, higher-risk visual change than "fix the design review's findings" warrants, and the review itself flagged this as the most subjective/lowest-priority item). This task applies one deliberate accent color to the single element that most defines the app's "personality" on every screen: the active bottom-nav tab. Violet is chosen because it's already the only intentional accent color in the codebase (the gym plan-builder's superset UI, `PlanBuilder.tsx`) rather than inventing a brand-new color with no precedent.

- [ ] **Step 1: Change the active-tab background from neutral to violet**

Before:
```tsx
                className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 text-xs font-medium transition-colors ${
                  active
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-900"
                }`}
```
After:
```tsx
                className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 text-xs font-medium transition-colors ${
                  active
                    ? "bg-violet-600 text-white dark:bg-violet-500 dark:text-white"
                    : "text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-900"
                }`}
```
(This is the same JSX block Task 4 already introduced — apply this change on top of Task 4's version rather than the pre-Task-4 original.)

- [ ] **Step 2: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

Manual check (`npm run dev`): confirm the active tab reads clearly in both light and dark mode (OS-level toggle, since there's no in-app theme switch) — violet-600/violet-500 against white text should have adequate contrast in both, but eyeball it.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/BottomNav.tsx
git commit -m "style: use violet as the app's one deliberate accent color for the active nav tab"
```

---

### Task 10: Safe-area top padding

**Files:**
- Modify: `web/src/app/gym/layout.tsx`, `web/src/app/(dashboard)/layout.tsx`

**Why:** Only `BottomNav.tsx`'s `pb-[env(safe-area-inset-bottom)]` accounts for safe-area insets today — nothing handles the top inset (notch/Dynamic Island). Neither layout currently has a *fixed* header that could visibly clip under one, but adding this defensively now (matching the bottom nav's existing pattern) means any future sticky header change doesn't silently reintroduce the gap, and it's a one-line, zero-risk addition either way.

- [ ] **Step 1: Add top safe-area padding to both layout wrappers**

In `web/src/app/gym/layout.tsx`, before:
```tsx
    <div className="flex min-h-dvh flex-col">
```
after:
```tsx
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
```

In `web/src/app/(dashboard)/layout.tsx`, apply the identical change to its matching `<div className="flex min-h-dvh flex-col">` wrapper.

- [ ] **Step 2: Verify**

Run: `cd web && npx tsc --noEmit`
Expected: no errors (this is a pure Tailwind class addition, nothing to break).

- [ ] **Step 3: Commit**

```bash
git add web/src/app/gym/layout.tsx "web/src/app/(dashboard)/layout.tsx"
git commit -m "fix: add top safe-area inset padding to both layout shells"
```

---

### Task 11: Offline fallback page

**Files:**
- Create: `web/src/app/offline/page.tsx`
- Modify: `web/src/app/sw.ts`

**Interfaces:**
- Produces: a static `/offline` route (no data fetching, so it's build-time static and lands in Next's precache manifest automatically) — consumed by the service worker's `fallbacks` config.

- [ ] **Step 1: Create the offline page**

Create `web/src/app/offline/page.tsx`:
```tsx
// Static (no data fetching) so it's part of the build's precache manifest —
// required by Serwist's fallbacks config (src/app/sw.ts), which can only
// fall back to a URL that's already been precached.
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold">You&apos;re offline</h1>
      <p className="mt-2 text-sm text-neutral-500">
        This page needs a connection. Gym logging still works offline — head to the Gym tab.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Register it as a navigation fallback in the service worker**

In `web/src/app/sw.ts`, before:
```ts
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [...defaultCache],
});
```
after:
```ts
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [...defaultCache],
  // Shown only when a navigation's own strategy (defaultCache's NetworkFirst
  // for pages, see the comment above) can't produce a response at all —
  // i.e. genuinely offline with nothing relevant cached — rather than
  // falling through to the browser's generic offline error.
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});
```

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: both succeed; confirm `/offline` appears as a static (`○`) route in the build's route table.

Manual check (production build required — `npm run build && npm start`, then in a browser with the SW active): visit any page once (to let the SW install and precache), go offline, then navigate (full reload, not a cached tab) to a route that was never visited and isn't part of the static precache (e.g. a made-up query string on a dynamic dashboard route) — confirm the `/offline` page appears instead of the browser's native error page.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/offline/page.tsx web/src/app/sw.ts
git commit -m "feat: add offline fallback page for uncached navigations"
```

---

### Task 12: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated suite**

Run: `cd web && npx vitest run`
Expected: PASS — every existing test, unaffected by this plan (no logic-layer code changed).

- [ ] **Step 2: Type-check and build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: both succeed; confirm `/offline` is in the route table alongside the existing routes.

- [ ] **Step 3: End-to-end manual/on-device walkthrough**

`npm run build && npm start`, ideally on the user's actual iPhone with the PWA installed (per the outstanding gap noted after the prior gym-feature plan — no browser automation tool is available in an agent session, so this step genuinely needs a human):
1. Re-install/re-add to home screen, confirm the icon and (if checked) launch behavior.
2. Tap through all 7 bottom-nav tabs — confirm icons render, active tab is violet, transitions are instant (no reload flash).
3. Visit each gym subpage directly and confirm the "← Gym" back-link works, and the weight-unit toggle + status badge appear consistently on all four gym pages.
4. Toggle kg/lb from any gym subpage (not just `/gym`) and confirm it now persists across all of them.
5. Tap near (not exactly on) the ↑/↓, Remove, Cancel, Clear, and Ungroup controls in the plan builder — confirm the larger tap area actually helps.
6. Go offline (airplane mode), confirm gym pages already visited still work, and confirm a never-visited/uncached route shows the new `/offline` page rather than a browser error.
7. Check both light and dark mode (OS toggle) for the new violet accent and the status header.

- [ ] **Step 4: Fix anything found as a follow-up commit in the relevant task's files — this introduces no new scope, only closes out issues found in the walkthrough.**
