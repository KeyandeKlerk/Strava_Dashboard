from pathlib import Path
from category import categorize_activity


def parse_activity(category_map: dict, raw: dict) -> dict:
    sport_type = raw.get("sport_type", "")
    name = raw.get("name", "")
    category = categorize_activity(category_map, sport_type=sport_type, name=name)

    distance_m = raw.get("distance") or 0
    moving_time_s = raw.get("moving_time") or 0
    elapsed_time_s = raw.get("elapsed_time") or 0
    relative_effort = raw.get("suffer_score")
    moving_time_min = moving_time_s / 60
    load_score = relative_effort if relative_effort is not None else moving_time_min

    # Strava reports cadence as steps/min per leg — double for full SPM
    raw_cadence = raw.get("average_cadence")
    cadence_spm = round(raw_cadence * 2, 1) if raw_cadence else None

    raw_speed = raw.get("average_speed") or 0
    speed_kmh = round(raw_speed * 3.6, 3) if raw_speed else None

    return {
        "id": raw["id"],
        "name": name,
        "sport_type": sport_type,
        "category": category,
        "start_date_local": raw.get("start_date_local", "").replace("Z", ""),
        "distance_km": round(distance_m / 1000, 3) if distance_m else None,
        "moving_time_min": round(moving_time_min, 2),
        "elapsed_time_min": round(elapsed_time_s / 60, 2),
        "elevation_gain_m": raw.get("total_elevation_gain"),
        "average_heartrate": raw.get("average_heartrate"),
        "max_heartrate": raw.get("max_heartrate"),
        "average_cadence": cadence_spm,
        "average_speed_kmh": speed_kmh,
        "relative_effort": relative_effort,
        "load_score": round(load_score, 2),
    }
