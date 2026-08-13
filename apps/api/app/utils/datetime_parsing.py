from datetime import datetime
from typing import Optional


def parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO 8601 datetime string sent by a client.

    `datetime.fromisoformat` only learned to accept the 'Z' UTC designator in
    Python 3.11. The API image is python:3.10-slim while development machines
    run newer interpreters, so a browser-produced timestamp — which is what
    JavaScript's `Date.toISOString()` emits, e.g. '2027-08-13T00:00:00.000Z' —
    parses locally and raises ValueError in production. Normalising the suffix
    to '+00:00' makes both agree no matter which interpreter is running.

    Returns None for empty input, matching the `if value else None` guards this
    replaced. Malformed input still raises ValueError, as it did before.
    """
    if not value:
        return None

    # Emptiness is checked after stripping too: a whitespace-only field is
    # empty in every sense that matters here, but "   " is truthy, so the guard
    # above lets it through and fromisoformat("") then raises.
    text = value.strip()
    if not text:
        return None

    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"

    return datetime.fromisoformat(text)
