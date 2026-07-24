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
                    ? "bg-violet-600 text-white" // violet-600 has adequate contrast (5.7:1) in both light and dark modes per WCAG AA
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
