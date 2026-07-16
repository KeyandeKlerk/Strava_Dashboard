export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "Today", icon: "\u{1F4C5}" },
  { href: "/fatigue", label: "Fatigue", icon: "\u{1F50B}" },
  { href: "/training-load", label: "Load", icon: "\u{1F4CA}" },
  { href: "/aerobic", label: "Aerobic", icon: "\u{2764}\u{FE0F}" },
  { href: "/race-prep", label: "Race", icon: "\u{1F3C1}" },
  { href: "/plan-history", label: "History", icon: "\u{1F4D6}" },
];
