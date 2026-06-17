import sys
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent))

import strava_client
from db import get_conn, init_schema, upsert_activity, get_last_synced, set_last_synced
from category import load_category_map
from parser import parse_activity

CATEGORY_MAP_PATH = Path(__file__).parent.parent / "category_map.yaml"


def run_sync(conn=None) -> None:
    if conn is None:
        conn = get_conn()
        init_schema(conn)

    category_map = load_category_map(CATEGORY_MAP_PATH)
    last_synced = get_last_synced(conn)

    print(f"Fetching activities {'(all time)' if not last_synced else f'after {last_synced}'}...")
    access_token = strava_client.refresh_access_token()
    raw_activities = strava_client.get_activities(access_token, after=last_synced)

    if not raw_activities:
        print("No new activities.")
    else:
        print(f"Syncing {len(raw_activities)} activities...")
        for raw in raw_activities:
            activity = parse_activity(category_map, raw)
            upsert_activity(conn, activity)

    now_ts = int(datetime.now(timezone.utc).timestamp())
    set_last_synced(conn, now_ts)
    print(f"Sync complete. {len(raw_activities) if raw_activities else 0} activities processed.")


if __name__ == "__main__":
    run_sync()
