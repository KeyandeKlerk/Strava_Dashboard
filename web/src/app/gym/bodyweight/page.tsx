import Link from "next/link";
import { getBodyWeightPageData } from "@/lib/pageData";
import { todayIso } from "@/lib/shared";
import { BodyWeightPage } from "@/components/gym/BodyWeightPage";

export const runtime = "nodejs";

export default async function GymBodyWeightPage() {
  const { logs, chartData } = await getBodyWeightPageData();
  const today = todayIso();

  return (
    <div>
      <Link href="/gym" className="text-xs text-neutral-500 underline">
        ← Gym
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Body Weight</h1>
      <p className="mt-1 text-sm text-neutral-500">Log your body weight and track it over time.</p>
      <div className="mt-4">
        <BodyWeightPage initialLogs={logs} initialChartData={chartData} today={today} />
      </div>
    </div>
  );
}
