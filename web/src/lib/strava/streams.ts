// Ported from src/streams.py.
import type { StreamsDerivedInput } from "../db/mutations";

export interface StravaStreamsResponse {
  heartrate?: { data?: number[] };
  altitude?: { data?: number[] };
  velocity_smooth?: { data?: number[] };
  grade_smooth?: { data?: number[] };
  cadence?: { data?: number[] };
}

export function computeStreamsDerived(
  streams: StravaStreamsResponse,
  activityId: number,
  hrZones: Array<[number, number]>,
): StreamsDerivedInput {
  const hrData = streams.heartrate?.data ?? [];
  const altData = streams.altitude?.data ?? [];
  const velData = streams.velocity_smooth?.data ?? [];
  const gradeData = streams.grade_smooth?.data ?? [];
  const cadenceData = streams.cadence?.data ?? [];

  const nHr = hrData.length;

  let elevationLoss = 0.0;
  for (let i = 1; i < altData.length; i++) {
    const delta = altData[i] - altData[i - 1];
    if (delta < 0) elevationLoss += Math.abs(delta);
  }

  const zoneCounts = new Array(hrZones.length).fill(0);
  for (const hr of hrData) {
    for (let i = 0; i < hrZones.length; i++) {
      const [lo, hi] = hrZones[i];
      if (hr >= lo && hr < hi) {
        zoneCounts[i] += 1;
        break;
      }
    }
  }
  const pctZones = zoneCounts.map((c) => (nHr > 0 ? Math.round((c / nHr) * 100 * 10) / 10 : 0.0));

  let decouplingPct: number | null = null;
  if (hrData.length > 0 && velData.length > 0 && nHr >= 20 && velData.length === nHr) {
    const mid = Math.floor(nHr / 2);
    const hrFirst = hrData.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const hrSecond = hrData.slice(mid).reduce((a, b) => a + b, 0) / (nHr - mid);
    const vFirst = velData.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const vSecond = velData.slice(mid).reduce((a, b) => a + b, 0) / (nHr - mid);
    const ratioFirst = hrFirst > 0 ? vFirst / hrFirst : 0;
    const ratioSecond = hrSecond > 0 ? vSecond / hrSecond : 0;
    if (ratioFirst > 0) {
      decouplingPct = Math.round(((ratioSecond - ratioFirst) / ratioFirst) * 100 * 100) / 100;
    }
  }

  let gap: number | null = null;
  if (velData.length > 0 && gradeData.length > 0 && velData.length === gradeData.length) {
    const adjustedVelocities: number[] = [];
    for (let i = 0; i < velData.length; i++) {
      const v = velData[i];
      const g = gradeData[i];
      if (v > 0) {
        // Each 1% grade ≈ +3.3% energy cost (Jack Daniels approximation)
        const gradeFactor = 1.0 + 0.033 * g;
        adjustedVelocities.push(v * gradeFactor);
      }
    }
    if (adjustedVelocities.length > 0) {
      const avgV = adjustedVelocities.reduce((a, b) => a + b, 0) / adjustedVelocities.length;
      gap = avgV > 0 ? Math.round((1000 / 60 / avgV) * 100) / 100 : null;
    }
  }

  let cadenceAvg: number | null = null;
  if (cadenceData.length > 0) {
    cadenceAvg = Math.round((cadenceData.reduce((a, b) => a + b, 0) / cadenceData.length) * 2 * 10) / 10;
  }

  return {
    activity_id: activityId,
    elevation_loss_m: Math.round(elevationLoss * 10) / 10,
    decoupling_pct: decouplingPct,
    pct_time_z1: pctZones[0] ?? 0.0,
    pct_time_z2: pctZones[1] ?? 0.0,
    pct_time_z3: pctZones[2] ?? 0.0,
    pct_time_z4: pctZones[3] ?? 0.0,
    pct_time_z5: pctZones[4] ?? 0.0,
    grade_adjusted_pace: gap,
    cadence_avg: cadenceAvg,
  };
}
