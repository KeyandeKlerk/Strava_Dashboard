function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800 ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <SkeletonBlock className="h-6 w-40" />
      <div className="grid grid-cols-2 gap-2">
        <SkeletonBlock className="h-16" />
        <SkeletonBlock className="h-16" />
      </div>
      <SkeletonBlock className="h-48 w-full" />
      <SkeletonBlock className="h-48 w-full" />
    </div>
  );
}
