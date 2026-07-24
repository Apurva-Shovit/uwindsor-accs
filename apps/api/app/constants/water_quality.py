SAFE_RANGES: dict = {
    "daily": {
        "ph": (6.5, 9.0),
        "temperature": (0.0, 40.0),
        "dissolved_oxygen": (5.0, 15.0),
    },
    "test_strip": {
        "nitrate": (0.0, 40.0),
        "nitrite": (0.0, 0.0),
        "hardness": (20.0, 450.0),
        "chlorine": (0.0, 0.0),
        "alkalinity": (120.0, 180.0),
        "ph": (6.5, 9.0),
        "ammonia": (0.0, 0.5),
    },
}


def validate_parameters(log_type: str, parameters: dict) -> dict:
    """
    Returns {param: {"value": v, "in_range": bool}} for each submitted param.
    NOT persisted – response-only.
    """
    ranges = SAFE_RANGES.get(log_type, {})
    result: dict = {}
    for key, value in parameters.items():
        bounds = ranges.get(key)
        if bounds is None:
            in_range = True
        else:
            low, high = bounds
            in_range = low <= float(value) <= high
        result[key] = {"value": value, "in_range": in_range}
    return result
