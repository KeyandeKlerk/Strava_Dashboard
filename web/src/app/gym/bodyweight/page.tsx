import { connection } from "next/server";
import { getBodyWeightPageData } from "@/lib/pageData";
import { todayIso } from "@/lib/shared";
import { BodyWeightPage } from "@/components/gym/BodyWeightPage";

export default async function GymBodyWeightPage() {
  await connection();
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
