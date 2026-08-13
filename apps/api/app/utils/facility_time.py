"""
Facility-local clock helpers.

"Server time" in the notification rules means the time the aquatics staff read
off the wall, not the UTC the API happens to run on. Production runs on UTC, so
resolving a 5 PM deadline against `datetime.now()` would fire it at 1 PM local
during EDT. Every time-of-day decision goes through here instead.
"""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..config import settings

_UTC = timezone.utc


def facility_tz():
    """
    The configured facility zone, falling back to UTC if the tz database is
    unavailable. Windows has no system tz database, so `tzdata` is a hard
    requirement (it is pinned in requirements.txt) — the fallback only keeps a
    misconfigured FACILITY_TIMEZONE from taking the whole API down.
    """
    try:
        return ZoneInfo(settings.FACILITY_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        return _UTC


def facility_now() -> datetime:
    """Current instant, expressed in facility-local time."""
    return datetime.now(_UTC).astimezone(facility_tz())


def facility_today() -> date:
    return facility_now().date()


def facility_datetime(day: date, hour: int = 0, minute: int = 0) -> datetime:
    """A wall-clock time on a given facility day, as an aware UTC datetime."""
    local = datetime.combine(day, time(hour=hour, minute=minute), tzinfo=facility_tz())
    return local.astimezone(_UTC)


def day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    """
    UTC range matching a stored `date` field for the given day.

    Beanie encodes `datetime.date` as a BSON datetime at midnight with no offset
    applied, so a log dated 2026-08-13 lands on 2026-08-13T00:00:00Z regardless
    of who submitted it. The range therefore has to be built in UTC, not in the
    facility zone.
    """
    start = datetime.combine(day, time.min, tzinfo=_UTC)
    return start, start + timedelta(days=1)


def as_utc(value: datetime | None) -> datetime | None:
    """
    Stamp a datetime read back from Mongo as UTC.

    Motor hands back naive datetimes for documents written without tzinfo, and
    comparing one of those against an aware `now()` raises. Everything stored is
    UTC, so attaching the offset is the correct reading.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=_UTC)
    return value.astimezone(_UTC)
