# tests/test_category.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from category import load_category_map, categorize_activity

MAP_PATH = Path(__file__).parent.parent / "category_map.yaml"


def test_load_category_map_returns_dict():
    m = load_category_map(MAP_PATH)
    assert "sport_type_map" in m
    assert "name_keyword_overrides" in m


def test_run_sport_type():
    m = load_category_map(MAP_PATH)
    assert categorize_activity(m, sport_type="Run", name="Morning Run") == "running"


def test_trail_run_sport_type():
    m = load_category_map(MAP_PATH)
    assert categorize_activity(m, sport_type="TrailRun", name="Trail Run") == "running"


def test_weight_training_sport_type():
    m = load_category_map(MAP_PATH)
    assert categorize_activity(m, sport_type="WeightTraining", name="Gym Session") == "gym"


def test_name_keyword_volleyball_overrides_other():
    m = load_category_map(MAP_PATH)
    assert categorize_activity(m, sport_type="Workout", name="Beach Volleyball") == "volleyball"


def test_name_keyword_cricket_overrides_other():
    m = load_category_map(MAP_PATH)
    assert categorize_activity(m, sport_type="Workout", name="Sunday Cricket Match") == "cricket"


def test_name_keyword_gym_overrides_other():
    m = load_category_map(MAP_PATH)
    assert categorize_activity(m, sport_type="Workout", name="Strength session") == "gym"


def test_unknown_sport_type_no_name_match():
    m = load_category_map(MAP_PATH)
    assert categorize_activity(m, sport_type="Kayaking", name="Kayak trip") == "other"
