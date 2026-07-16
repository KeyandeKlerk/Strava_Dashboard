// Ported from src/strava_client.py.
import type { DuckDBConnection } from "@duckdb/node-api";
import { getRefreshToken, setRefreshToken } from "../db/mutations";
import type { RawStravaActivity } from "./parser";
import type { StravaStreamsResponse } from "./streams";

const TOKEN_URL = "https://www.strava.com/oauth/token";
const API_BASE = "https://www.strava.com/api/v3";

export async function refreshAccessToken(conn: DuckDBConnection): Promise<string> {
  const stored = await getRefreshToken(conn);
  const currentRefresh = stored ?? requireEnv("STRAVA_REFRESH_TOKEN");

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("STRAVA_CLIENT_ID"),
      client_secret: requireEnv("STRAVA_CLIENT_SECRET"),
      refresh_token: currentRefresh,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error(`Strava token refresh failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();

  const newRefresh: string | undefined = data.refresh_token;
  if (newRefresh && newRefresh !== currentRefresh) {
    await setRefreshToken(conn, newRefresh);
  }

  return data.access_token as string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function stravaFetch(path: string, accessToken: string, params?: Record<string, string | number>) {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  }
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) throw new Error(`Strava API ${path} failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

export async function getActivities(
  accessToken: string,
  after?: number,
  perPage = 200,
): Promise<RawStravaActivity[]> {
  const activities: RawStravaActivity[] = [];
  let page = 1;

  while (true) {
    const params: Record<string, string | number> = { per_page: perPage, page };
    if (after !== undefined) params.after = after;

    const batch = (await stravaFetch("/athlete/activities", accessToken, params)) as RawStravaActivity[];
    if (!batch || batch.length === 0) break;
    activities.push(...batch);
    page += 1;
  }

  return activities;
}

export async function getActivityStreams(accessToken: string, activityId: number): Promise<StravaStreamsResponse> {
  return stravaFetch(`/activities/${activityId}/streams`, accessToken, {
    keys: "heartrate,altitude,velocity_smooth,grade_smooth,cadence",
    key_by_type: "true",
  }) as Promise<StravaStreamsResponse>;
}

export interface AthleteZonesResponse {
  heart_rate?: { zones?: Array<{ min: number; max: number }> };
}

export async function getAthleteZones(accessToken: string): Promise<AthleteZonesResponse> {
  return stravaFetch("/athlete/zones", accessToken) as Promise<AthleteZonesResponse>;
}

export async function getGear(accessToken: string, gearId: string): Promise<{ name?: string } | null> {
  const url = new URL(`${API_BASE}/gear/${gearId}`);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (resp.status !== 200) return null;
  return resp.json();
}
