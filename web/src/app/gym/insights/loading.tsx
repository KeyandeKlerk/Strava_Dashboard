function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800 ${className}`} />;
}

export default function GymInsightsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonBlock className="h-6 w-32" />
      <div className="grid grid-cols-2 gap-2">
        <SkeletonBlock className="h-16" />
        <SkeletonBlock className="h-16" />
      </div>
      <SkeletonBlock className="h-40 w-full" />
      <SkeletonBlock className="h-40 w-full" />
    </div>
  );
}
