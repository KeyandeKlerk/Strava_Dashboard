"use client";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";

// Plain <a> tags rather than next/link's <Link>: a full navigation's plain
// HTML GET works the same whether or not a service worker is active, unlike
// client-side transitions which fetch an RSC payload.

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
          return (
            <li key={item.href} className="flex-1">
              <a
                href={item.href}
                className={`flex items-center justify-center rounded-xl py-3 text-sm font-medium transition-colors ${
                  active
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-900"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
