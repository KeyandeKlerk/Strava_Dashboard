function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800 ${className}`} />;
}

export default function GymBodyWeightLoading() {
  return (
    <div className="space-y-4">
      <SkeletonBlock className="h-6 w-32" />
      <SkeletonBlock className="h-40 w-full" />
      <SkeletonBlock className="h-64 w-full" />
    </div>
  );
}
