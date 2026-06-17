from pathlib import Path
import yaml


def load_category_map(path: Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def categorize_activity(category_map: dict, sport_type: str, name: str) -> str:
    sport_map = category_map.get("sport_type_map", {})
    keyword_map = category_map.get("name_keyword_overrides", {})

    category = sport_map.get(sport_type, "other")

    if category == "other":
        name_lower = name.lower()
        for keyword, cat in keyword_map.items():
            if keyword in name_lower:
                return cat

    return category
