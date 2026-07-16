import { FLAG_EMOJI, type Flag } from "@/lib/shared";

export function StatCard({
  label,
  value,
  caption,
  flag,
}: {
  label: string;
  value: string;
  caption?: string;
  flag?: Flag;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">
        {flag && <span aria-hidden="true">{FLAG_EMOJI[flag]} </span>}
        {label}
      </div>
      <div className="text-xl font-semibold">{value}</div>
      {caption && <p className="mt-1 text-xs text-neutral-500">{caption}</p>}
    </div>
  );
}
