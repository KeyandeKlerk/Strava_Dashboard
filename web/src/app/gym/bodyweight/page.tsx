import { getBodyWeightPageData } from "@/lib/pageData";
import { todayIso } from "@/lib/shared";
import { BodyWeightPage } from "@/components/gym/BodyWeightPage";

// This page (like /gym/plan) doesn't need offline support — logging bodyweight
// isn't a live-at-the-gym-mid-workout action, it can be done anytime with
// connectivity — so it can opt into per-request freshness independently of
// the /gym shell's static route. See web/src/app/gym/layout.tsx's header
// comment for why the shell itself stays static.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function GymBodyWeightPage() {
  const { logs, chartData } = await getBodyWeightPageData();
  const today = todayIso();

  return (
    <div>
      <h1 className="text-lg font-semibold">Body Weight</h1>
      <p className="mt-1 text-sm text-neutral-500">Log your body weight and track it over time.</p>
      <div className="mt-4">
        <BodyWeightPage initialLogs={logs} initialChartData={chartData} today={today} />
      </div>
    </div>
  );
}
