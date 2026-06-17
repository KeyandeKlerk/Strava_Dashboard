HR_ZONES = [(0, 130), (130, 148), (148, 162), (162, 174), (174, 9999)]


def compute_streams_derived(streams: dict, activity: dict) -> dict:
    hr_data = streams.get("heartrate", {}).get("data", [])
    alt_data = streams.get("altitude", {}).get("data", [])
    vel_data = streams.get("velocity_smooth", {}).get("data", [])
    grade_data = streams.get("grade_smooth", {}).get("data", [])
    cadence_data = streams.get("cadence", {}).get("data", [])

    n_hr = len(hr_data)

    # Elevation loss (sum of negative altitude deltas)
    elevation_loss = 0.0
    for i in range(1, len(alt_data)):
        delta = alt_data[i] - alt_data[i - 1]
        if delta < 0:
            elevation_loss += abs(delta)

    # Time in HR zones
    zone_counts = [0] * 5
    for hr in hr_data:
        for i, (lo, hi) in enumerate(HR_ZONES):
            if lo <= hr < hi:
                zone_counts[i] += 1
                break
    pct_zones = [round(c / n_hr * 100, 1) if n_hr > 0 else 0.0 for c in zone_counts]

    # Aerobic decoupling (pace:HR efficiency ratio, first half vs second half)
    decoupling_pct = None
    if hr_data and vel_data and n_hr >= 20 and len(vel_data) == n_hr:
        mid = n_hr // 2
        hr_first = sum(hr_data[:mid]) / mid
        hr_second = sum(hr_data[mid:]) / (n_hr - mid)
        v_first = sum(vel_data[:mid]) / mid
        v_second = sum(vel_data[mid:]) / (n_hr - mid)
        ratio_first = v_first / hr_first if hr_first > 0 else 0
        ratio_second = v_second / hr_second if hr_second > 0 else 0
        if ratio_first > 0:
            decoupling_pct = round((ratio_second - ratio_first) / ratio_first * 100, 2)

    # Grade-adjusted pace (average, converted to min/km)
    gap = None
    if vel_data and grade_data and len(vel_data) == len(grade_data):
        adjusted_velocities = []
        for v, g in zip(vel_data, grade_data):
            if v > 0:
                # Each 1% grade ≈ +3.3% energy cost (Jack Daniels approximation)
                grade_factor = 1.0 + 0.033 * g
                adjusted_v = v * grade_factor
                adjusted_velocities.append(adjusted_v)
        if adjusted_velocities:
            avg_v = sum(adjusted_velocities) / len(adjusted_velocities)
            gap = round(1000 / 60 / avg_v, 2) if avg_v > 0 else None

    # Cadence (double the Strava half-cadence to get full SPM)
    cadence_avg = None
    if cadence_data:
        cadence_avg = round(sum(cadence_data) / len(cadence_data) * 2, 1)

    return {
        "activity_id": activity["id"],
        "elevation_loss_m": round(elevation_loss, 1),
        "decoupling_pct": decoupling_pct,
        "pct_time_z1": pct_zones[0],
        "pct_time_z2": pct_zones[1],
        "pct_time_z3": pct_zones[2],
        "pct_time_z4": pct_zones[3],
        "pct_time_z5": pct_zones[4],
        "grade_adjusted_pace": gap,
        "cadence_avg": cadence_avg,
    }
