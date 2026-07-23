import { getWeeklyPlanAction, listGymExercisesAction } from "@/lib/gymActions";
import { PlanBuilder } from "@/components/gym/PlanBuilder";

// This page (unlike the /gym shell) doesn't need offline support — plan
// editing is online-only by design — so it can opt into per-request
// freshness independently of that route's static shell. See
// web/src/app/gym/layout.tsx's header comment for why the shell itself
// stays static.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function GymPlanPage() {
  const [plan, exercises] = await Promise.all([getWeeklyPlanAction(), listGymExercisesAction()]);

  return (
    <div>
      <h1 className="text-lg font-semibold">Weekly Gym Plan</h1>
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
