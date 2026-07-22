export interface NavItem {
  href: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "Today" },
  { href: "/fatigue", label: "Fatigue" },
  { href: "/training-load", label: "Load" },
  { href: "/aerobic", label: "Aerobic" },
  { href: "/race-prep", label: "Race" },
  { href: "/plan-history", label: "History" },
  { href: "/gym", label: "Gym" },
];
