function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800 ${className}`} />;
}

export default function GymPlanLoading() {
  return (
    <div className="space-y-4">
      <SkeletonBlock className="h-6 w-48" />
      <SkeletonBlock className="h-4 w-full" />
      <SkeletonBlock className="h-64 w-full" />
    </div>
  );
}
