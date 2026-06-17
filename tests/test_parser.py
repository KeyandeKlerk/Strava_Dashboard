# tests/test_parser.py
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from parser import parse_activity
from category import load_category_map

MAP_PATH = Path(__file__).parent.parent / "category_map.yaml"

RAW_RUN = {
    "id": 9876543210,
    "name": "Morning Run",
    "sport_type": "Run",
    "start_date_local": "2024-03-15T07:30:00Z",
    "distance": 12500.0,
    "moving_time": 3900,
    "elapsed_time": 4080,
    "total_elevation_gain": 145.0,
    "average_heartrate": 148.0,
    "max_heartrate": 168.0,
    "average_cadence": 86.0,
    "average_speed": 3.205,
    "suffer_score": 95.0,
}

RAW_GYM = {
    "id": 1234567890,
    "name": "Gym Session",
    "sport_type": "WeightTraining",
    "start_date_local": "2024-03-16T08:00:00Z",
    "distance": 0,
    "moving_time": 3600,
    "elapsed_time": 3700,
    "total_elevation_gain": 0.0,
    "average_heartrate": None,
    "max_heartrate": None,
    "average_cadence": None,
    "average_speed": 0.0,
    "suffer_score": None,
}


def test_parse_run_fields():
    m = load_category_map(MAP_PATH)
    a = parse_activity(m, RAW_RUN)
    assert a["id"] == 9876543210
    assert a["category"] == "running"
    assert a["distance_km"] == pytest.approx(12.5)
    assert a["moving_time_min"] == pytest.approx(65.0)
    assert a["average_speed_kmh"] == pytest.approx(11.538, rel=1e-2)
    assert a["load_score"] == 95.0
    assert "Z" not in a["start_date_local"]


def test_parse_run_cadence_doubled():
    # Strava reports cadence as half-cadence (steps/min per leg), double it for SPM
    m = load_category_map(MAP_PATH)
    a = parse_activity(m, RAW_RUN)
    assert a["average_cadence"] == pytest.approx(172.0)


def test_parse_gym_no_distance():
    m = load_category_map(MAP_PATH)
    a = parse_activity(m, RAW_GYM)
    assert a["category"] == "gym"
    assert a["distance_km"] is None


def test_parse_gym_load_score_falls_back_to_duration():
    m = load_category_map(MAP_PATH)
    a = parse_activity(m, RAW_GYM)
    # No suffer_score → load_score = moving_time_min = 60.0
    assert a["load_score"] == pytest.approx(60.0)


def test_parse_volleyball_by_name():
    m = load_category_map(MAP_PATH)
    raw = {**RAW_GYM, "id": 999, "name": "Beach Volleyball", "sport_type": "Workout"}
    a = parse_activity(m, raw)
    assert a["category"] == "volleyball"
