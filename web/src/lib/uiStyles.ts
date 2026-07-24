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
