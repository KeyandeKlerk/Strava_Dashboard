"use client";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";

// Plain <a> tags rather than next/link's <Link>: client-side transitions
// fetch an RSC payload, which has no offline fallback. A full navigation's
// plain HTML GET is what the service worker's CacheFirst rule (src/app/sw.ts)
// can actually serve from the precached dashboard-pages cache when offline.

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-neutral-200 bg-white/95 backdrop-blur
                 pb-[env(safe-area-inset-bottom)] dark:border-neutral-800 dark:bg-neutral-950/95"
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-3xl">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex-1">
              <a
                href={item.href}
                className={`flex flex-col items-center gap-0.5 py-2 text-xs ${
                  active
                    ? "text-neutral-900 dark:text-neutral-100"
                    : "text-neutral-400 dark:text-neutral-500"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className="text-lg leading-none" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
