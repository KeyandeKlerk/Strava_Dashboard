import Link from "next/link";
import { getWeeklyPlanAction, listGymExercisesAction } from "@/lib/gymActions";
import { PlanBuilder } from "@/components/gym/PlanBuilder";

export const runtime = "nodejs";

export default async function GymPlanPage() {
  const [plan, exercises] = await Promise.all([getWeeklyPlanAction(), listGymExercisesAction()]);

  return (
    <div>
      <Link href="/gym" className="text-xs text-neutral-500 underline">
        ← Gym
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Weekly Gym Plan</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Pick which days you gym and which exercises go on each day. Starting a session on a
        planned day loads these automatically.
      </p>
      <div className="mt-4">
        <PlanBuilder initialPlan={plan} allExercises={exercises} />
      </div>
    </div>
  );
}
