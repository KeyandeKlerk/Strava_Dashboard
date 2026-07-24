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
