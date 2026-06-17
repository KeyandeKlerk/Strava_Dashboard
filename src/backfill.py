import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import strava_client
from db import get_conn, init_schema, upsert_streams_derived
from streams import compute_streams_derived

STREAMS_DISTANCE_THRESHOLD_KM = 0.0
# Strava rate limit: 200 req/15min = ~13/min → 5s sleep keeps us safely under
RATE_LIMIT_SLEEP = 5.0


def run_backfill(conn=None) -> None:
    if conn is None:
        conn = get_conn()
        init_schema(conn)

    candidates = conn.execute("""
        SELECT a.id, a.name, a.distance_km
        FROM activities a
        LEFT JOIN activity_streams_derived sd ON a.id = sd.activity_id
        WHERE a.category = 'running'
          AND a.distance_km >= ?
          AND sd.activity_id IS NULL
        ORDER BY a.start_date_local DESC
    """, [STREAMS_DISTANCE_THRESHOLD_KM]).fetchall()

    if not candidates:
        print("No activities need streams backfill.")
        return

    print(f"Fetching streams for {len(candidates)} activities...")
    access_token = strava_client.refresh_access_token()

    for i, (activity_id, name, distance_km) in enumerate(candidates, 1):
        print(f"  [{i}/{len(candidates)}] {name} ({distance_km:.1f} km)...")
        try:
            streams = strava_client.get_activity_streams(access_token, activity_id)
            activity = {"id": activity_id}
            derived = compute_streams_derived(streams, activity)
            upsert_streams_derived(conn, derived)
        except Exception as e:
            print(f"    Warning: failed for activity {activity_id}: {e}")
        time.sleep(RATE_LIMIT_SLEEP)

    print("Backfill complete.")


if __name__ == "__main__":
    run_backfill()
