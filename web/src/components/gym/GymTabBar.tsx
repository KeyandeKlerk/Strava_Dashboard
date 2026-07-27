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
    <nav
      aria-label="Gym sections"
      className="mb-4 flex border-b border-neutral-200 dark:border-neutral-800"
      style={{ viewTransitionName: "gym-tab-bar" }}
    >
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
