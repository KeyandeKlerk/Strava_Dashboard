import { getGymInsightsPageData } from "@/lib/pageData";
import { StatCard } from "@/components/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import { MuscleGroupVolumeChart, SessionsPerWeekChart, VolumeByWeekChart } from "@/components/charts/GymCharts";
import { ExerciseProgressionSection } from "@/components/gym/ExerciseProgressionSection";

// This page (unlike the /gym shell) doesn't need offline support, so it can
// opt into per-request freshness independently of that route's static shell
// — see web/src/app/gym/layout.tsx's header comment for why the shell itself
// stays static.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function GymInsightsPage() {
  const { weeklyVolume, muscleGroups, muscleVolumePivoted, sessionsPerWeek, records, muscleFrequency, exercises, defaultExerciseId, defaultProgression } =
    await getGymInsightsPageData();

  const latestWeekVolume = weeklyVolume[weeklyVolume.length - 1]?.total_volume_kg ?? 0;
  const latestWeekSessions = sessionsPerWeek[sessionsPerWeek.length - 1]?.session_count ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Gym Insights</h1>

      <div className="grid grid-cols-2 gap-2">
        <StatCard label="This Week's Volume" value={`${Math.round(latestWeekVolume)} kg`} />
        <StatCard label="Sessions This Week" value={String(latestWeekSessions)} />
      </div>

      {weeklyVolume.length > 0 ? (
        <ChartCard title="Weekly Volume" subtitle="Total weight x reps lifted per week, kg.">
          <VolumeByWeekChart data={weeklyVolume} />
        </ChartCard>
      ) : (
        <p className="text-sm text-neutral-500">No gym sessions logged yet.</p>
      )}

      {muscleVolumePivoted.length > 0 && (
        <ChartCard title="Volume by Muscle Group" subtitle="Weekly volume, kg, split by muscle group.">
          <MuscleGroupVolumeChart data={muscleVolumePivoted} muscleGroups={muscleGroups} />
        </ChartCard>
      )}

      {sessionsPerWeek.length > 0 && (
        <ChartCard title="Sessions per Week" subtitle="Gym sessions logged per week.">
          <SessionsPerWeekChart data={sessionsPerWeek} />
        </ChartCard>
      )}

      <div>
        <h2 className="text-base font-semibold">Exercise Progression</h2>
        <ExerciseProgressionSection
          exercises={exercises}
          defaultExerciseId={defaultExerciseId}
          defaultProgression={defaultProgression}
        />
      </div>

      <div>
        <h2 className="text-base font-semibold">Personal Records</h2>
        {records.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No personal records yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {records.map((r) => (
              <li key={r.exercise_id} className="py-2">
                <p className="font-medium">{r.exercise_name}</p>
                <p className="text-xs text-neutral-500">
                  Heaviest: {r.max_weight_kg} kg ({r.max_weight_date}) · Best est. 1RM: {r.best_est_1rm.toFixed(1)} kg (
                  {r.best_est_1rm_date})
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold">Muscle Group Frequency</h2>
        <ul className="mt-2 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
          {muscleFrequency
            .filter((m) => m.last_trained_date != null)
            .map((m) => (
              <li key={m.muscle_group} className="flex items-center justify-between py-2">
                <span>{m.muscle_group}</span>
                <span className="text-neutral-500">
                  Last: {m.last_trained_date} · {m.sessions_last_4_weeks} sessions/4wk
                </span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
