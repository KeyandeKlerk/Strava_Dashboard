// Small shared loading indicator — replaces plain "Loading..." text in the
// two sheet components that show it. Pure CSS spin, no new dependency.
export function LoadingSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-500 dark:border-neutral-700 dark:border-t-neutral-400"
      />
      <span>{label}...</span>
    </div>
  );
}
