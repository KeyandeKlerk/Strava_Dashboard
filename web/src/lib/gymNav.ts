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
