# tests/test_streams.py
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from streams import compute_streams_derived

SAMPLE_STREAMS = {
    "heartrate": {
        "data": [130] * 50 + [145] * 50 + [155] * 50 + [165] * 20 + [140] * 30
    },
    "altitude": {
        "data": [100] + [100 + i * 0.5 for i in range(99)] + [150 - i * 0.5 for i in range(100)]
        # climbs 49.5m, descends 49.5m
    },
    "velocity_smooth": {
        "data": [3.0] * 100 + [2.8] * 100
    },
    "grade_smooth": {
        "data": [0.0] * 200
    },
    "cadence": {
        "data": [86] * 200
    },
}

ACTIVITY = {"id": 1001}


def test_compute_elevation_loss():
    streams = {
        "altitude": {"data": [100, 105, 103, 100, 98]},
        "heartrate": {"data": []},
        "velocity_smooth": {"data": []},
        "grade_smooth": {"data": []},
        "cadence": {"data": []},
    }
    result = compute_streams_derived(streams, ACTIVITY)
    # descents: 105→103 = 2m, 103→100 = 3m, 100→98 = 2m → total 7m
    assert result["elevation_loss_m"] == pytest.approx(7.0)


def test_compute_pct_time_zones_sums_to_100():
    result = compute_streams_derived(SAMPLE_STREAMS, ACTIVITY)
    total = (
        result["pct_time_z1"] + result["pct_time_z2"] + result["pct_time_z3"]
        + result["pct_time_z4"] + result["pct_time_z5"]
    )
    assert total == pytest.approx(100.0, abs=0.5)


def test_compute_cadence_avg():
    streams = {**SAMPLE_STREAMS, "cadence": {"data": [86] * 100 + [88] * 100}}
    result = compute_streams_derived(streams, ACTIVITY)
    # Cadence doubled: avg of 86+88=87, doubled = 174
    assert result["cadence_avg"] == pytest.approx(174.0)


def test_compute_decoupling_returns_float():
    result = compute_streams_derived(SAMPLE_STREAMS, ACTIVITY)
    assert isinstance(result["decoupling_pct"], float)


def test_compute_gap_flat_course():
    flat_streams = {
        "heartrate": {"data": [145] * 200},
        "altitude": {"data": [100.0] * 200},
        "velocity_smooth": {"data": [3.0] * 200},
        "grade_smooth": {"data": [0.0] * 200},
        "cadence": {"data": [86] * 200},
    }
    result = compute_streams_derived(flat_streams, ACTIVITY)
    # On flat course (grade=0), GAP = actual pace = 3.0 m/s → 1000/60/3.0 = 5.556 min/km
    assert result["grade_adjusted_pace"] == pytest.approx(5.56, rel=0.05)


def test_activity_id_in_result():
    result = compute_streams_derived(SAMPLE_STREAMS, ACTIVITY)
    assert result["activity_id"] == 1001
