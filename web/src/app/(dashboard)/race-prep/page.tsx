import { getConnection, queryRow } from "@/lib/db/client";
import { getAllRaceEvents } from "@/lib/db/mutations";
import {
  backToBackRuns,
  comradesMilestones,
  comradesProjectedSplits,
  COMRADES_CHECKPOINTS,
  shoeMileage,
  weeklyElevation,
} from "@/lib/metrics";
import { BANDS, RACE_DATE, RACE_DISTANCE_KM, fmtPace } from "@/lib/shared";
import { ElevationProfileChart, WeeklyElevationChart } from "@/components/charts/RaceCharts";
import { addRaceEvent } from "./actions";

export const runtime = "nodejs";

interface RaceEventRow {
  id: number;
  name: string;
  race_date: string;
  distance_km: number;
  priority: string;
  target_finish_h: number | null;
  notes: string | null;
  strava_activity_id: number | null;
}

export default async function RacePrepPage() {
  const conn = await getConnection();
  const [races, milestones, b2b, elevation, splits, shoes] = await Promise.all([
    getAllRaceEvents<RaceEventRow>(conn),
    comradesMilestones(conn, RACE_DISTANCE_KM),
    backToBackRuns(conn),
    weeklyElevation(conn),
    comradesProjectedSplits(conn),
    shoeMileage(conn),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const analysed = races.filter((r) => r.strava_activity_id);
  const analyses = await Promise.all(
    analysed.map((r) =>
      queryRow<{ avg_pace_min_km: number | null; comrades_projection_h: number | null; computed_at: string }>(
        conn,
        "SELECT avg_pace_min_km, comrades_projection_h::VARCHAR AS comrades_projection_h, computed_at::VARCHAR AS computed_at FROM race_analysis WHERE race_event_id = $id",
        { id: r.id },
      ),
    ),
  );

  const elevationProfile = COMRADES_CHECKPOINTS.map(([checkpoint, km, elevation_m]) => ({ checkpoint, km, elevation_m }));

  // Precomputed (not mutated during JSX mapping): each band is "on track" if
  // the projection falls in [previous band's cutoff, this band's cutoff).
  const bandRows = BANDS.reduce<Array<{ medal: string; label: string; onTrack: boolean }>>(
    (rows, [medal, label, cutoffH]) => {
      const prevH = rows.length > 0 ? BANDS[rows.length - 1][2] : 0;
      const onTrack =
        milestones.projected_finish_h != null &&
        prevH <= milestones.projected_finish_h &&
        milestones.projected_finish_h < cutoffH;
      return [...rows, { medal, label, onTrack }];
    },
    [],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Race Calendar</h1>
        {races.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No races scheduled yet. Add one below.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {races.map((r) => {
              const status = r.strava_activity_id ? "analysed" : r.race_date < today ? "completed" : "upcoming";
              return (
                <div key={r.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <div className="flex justify-between font-medium">
                    <span>{r.name}</span>
                    <span className="text-neutral-500">{status}</span>
                  </div>
                  <div className="text-neutral-500">
                    {r.race_date} · {r.distance_km} km · Priority {r.priority}
                    {r.target_finish_h ? ` · target ${r.target_finish_h.toFixed(1)}h` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {analysed.length > 0 && (
          <div className="mt-3 space-y-2">
            {analysed.map((r, i) => {
              const ra = analyses[i];
              return (
                <div key={r.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <p className="font-medium">
                    Analysis — {r.name} ({r.race_date})
                  </p>
                  {ra ? (
                    <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-neutral-500">
                      <div>Avg pace: {fmtPace(ra.avg_pace_min_km)} min/km</div>
                      <div>Projection: {ra.comrades_projection_h ? `${Number(ra.comrades_projection_h).toFixed(2)}h` : "—"}</div>
                      <div>Analysed: {ra.computed_at?.slice(0, 10) ?? "—"}</div>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-neutral-500">No analysis data yet — run sync after the race.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">Add race</summary>
          <form action={addRaceEvent} className="mt-2 space-y-2">
            <input name="name" placeholder="Race name" required className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            <input name="race_date" type="date" required className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            <input name="distance_km" type="number" step="0.1" min="1" max="250" defaultValue={42.2} required className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            <select name="priority" className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900">
              <option value="A">A</option>
              <option value="B">B</option>
            </select>
            <input name="target_finish_h" type="number" step="0.25" min="0" max="24" placeholder="Target finish (h), 0 = none" className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            <textarea name="notes" placeholder="Notes" className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            <button type="submit" className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
              Save race
            </button>
          </form>
        </details>
      </div>

      <div>
        <h2 className="text-base font-semibold">Comrades 2027 Milestones</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <MilestoneStat label="Longest Run" value={`${milestones.longest_run_km.toFixed(1)} km`} sub={`${milestones.longest_run_pct_race.toFixed(0)}% of race`} />
          <MilestoneStat label="Total Elev Gain" value={`${milestones.total_gain_m.toLocaleString()} m`} />
          <MilestoneStat
            label="Descent Practiced"
            value={`${milestones.total_descent_m.toFixed(0)} m`}
            sub={`${milestones.descent_pct_practiced.toFixed(0)}% of ${milestones.race_descent_m.toFixed(0)}m target`}
          />
          <MilestoneStat label="Runs ≥30 km" value={String(milestones.runs_30plus)} sub={`${milestones.runs_20plus} runs ≥20 km`} />
          <MilestoneStat label="Best Back-to-Back" value={milestones.max_b2b_km ? `${milestones.max_b2b_km.toFixed(1)} km` : "—"} />
          <MilestoneStat
            label="Projected Finish"
            value={milestones.projected_finish_h ? `${milestones.projected_finish_h.toFixed(2)}h` : "—"}
            sub={`vs ${milestones.cutoff_h.toFixed(0)}h cutoff`}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {elevation.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-neutral-500">Weekly Elevation Gain (m)</h3>
              <WeeklyElevationChart data={elevation} />
            </div>
          )}
          <div>
            <h3 className="text-sm font-medium text-neutral-500">Comrades Finish Time Bands</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {bandRows.map(({ medal, label, onTrack }) => (
                <li key={medal} className={onTrack ? "font-semibold" : "text-neutral-500"}>
                  {onTrack ? "🎯 " : "　 "}
                  {medal} — {label}
                </li>
              ))}
            </ul>
            {milestones.projected_finish_h == null && (
              <p className="mt-1 text-xs text-neutral-500">No projected time yet — need runs ≥25 km to estimate.</p>
            )}
          </div>
        </div>

        {b2b.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-neutral-500">Back-to-Back Long Runs</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-neutral-500">
                    <th className="py-1 pr-2">Day 1</th>
                    <th className="py-1 pr-2">Day 2</th>
                    <th className="py-1 pr-2">Combined (km)</th>
                  </tr>
                </thead>
                <tbody>
                  {b2b.slice(0, 10).map((r) => (
                    <tr key={`${r.day1}-${r.day2}`} className="border-t border-neutral-100 dark:border-neutral-900">
                      <td className="py-1 pr-2">{r.day1}</td>
                      <td className="py-1 pr-2">{r.day2}</td>
                      <td className="py-1 pr-2">{r.combined_km.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {splits.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-neutral-500">Projected Splits</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-neutral-500">
                    <th className="py-1 pr-2">Checkpoint</th>
                    <th className="py-1 pr-2">km</th>
                    <th className="py-1 pr-2">Projected Time</th>
                  </tr>
                </thead>
                <tbody>
                  {splits.map((s) => (
                    <tr key={s.checkpoint} className="border-t border-neutral-100 dark:border-neutral-900">
                      <td className="py-1 pr-2">{s.checkpoint}</td>
                      <td className="py-1 pr-2">{s.km.toFixed(0)}</td>
                      <td className="py-1 pr-2">{s.cumulative_time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <ElevationProfileChart data={elevationProfile} />
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-neutral-500">
            No projection available yet — add a tune-up race and run sync to generate splits.
          </p>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold">Shoe Mileage</h2>
        {shoes.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No shoe data yet — link your gear in Strava and run sync.</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {shoes.map((shoe) => {
              const pct = shoe.retire_km_threshold > 0 ? Math.min(1, shoe.total_km / shoe.retire_km_threshold) : 1;
              const remain = shoe.km_remaining;
              const flagColor = remain < 0 ? "bg-red-500" : remain < 100 ? "bg-amber-500" : "bg-emerald-500";
              return (
                <div key={shoe.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <p className="font-medium">{shoe.name}</p>
                  <p className="text-xs text-neutral-500">{shoe.type ? shoe.type[0].toUpperCase() + shoe.type.slice(1) : "Road"}</p>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div className={`h-full ${flagColor}`} style={{ width: `${pct * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    {shoe.total_km.toFixed(0)} / {shoe.retire_km_threshold.toFixed(0)} km
                    {remain < 0 ? ` · ${Math.abs(remain).toFixed(0)} km over limit` : ` · ${remain.toFixed(0)} km remaining`}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-xs text-neutral-400">Race date reference: {RACE_DATE}</p>
    </div>
  );
}

function MilestoneStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}
