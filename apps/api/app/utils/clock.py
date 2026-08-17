"""
Time handling for the notification rules.

Two clocks are in play and conflating them is how the deadline ends up firing at
the wrong hour. Instants — when a quarantine window closes, when a row was
written — are UTC, because that is what Mongo stores and what the API runs on.
The daily log deadline is a *wall-clock* time in the facility's own zone, because
"3 PM" means 3 PM to the person holding the clipboard on both sides of the
daylight-saving change. Everything that needs the second kind takes the zone as
an argument rather than reading a global, since chairs and admins can change it
at runtime.
"""
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = timezone.utc


def resolve_zone(name: str | None) -> tzinfo:
    """
    A tzinfo for a IANA zone name, falling back to UTC.

    The fallback exists so a bad stored value degrades to a working deadline
    instead of failing every request; `is_valid_zone` is what stops a bad value
    being stored in the first place.
    """
    if not name:
        return UTC
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def is_valid_zone(name: str | None) -> bool:
    if not name:
        return False
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def now_utc() -> datetime:
    """Current instant, always timezone-aware."""
    return datetime.now(UTC)


def local_date(moment: datetime, zone: tzinfo) -> date:
    """Which facility day an instant falls on."""
    return moment.astimezone(zone).date()


def deadline_at(day: date, hour: int, minute: int, zone: tzinfo) -> datetime:
    """
    The instant a given facility day's deadline passes, as aware UTC.

    Built by attaching the zone to the wall-clock time and converting, so the
    UTC offset is whichever one was actually in force on that date — 3 PM stays
    3 PM across the March and November transitions.
    """
    return datetime.combine(day, time(hour=hour, minute=minute), tzinfo=zone).astimezone(UTC)


def zone_abbreviation(zone: tzinfo, moment: datetime | None = None) -> str:
    """The zone's short name on a given date, e.g. EST in January, EDT in July."""
    return (moment or now_utc()).astimezone(zone).tzname() or "UTC"


def format_deadline(hour: int, minute: int, zone: tzinfo, moment: datetime | None = None) -> str:
    """A human label for the cutoff, e.g. '3:00 PM EDT'."""
    suffix = "AM" if hour < 12 else "PM"
    return f"{hour % 12 or 12}:{minute:02d} {suffix} {zone_abbreviation(zone, moment)}"


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """
    Range matching a stored `date` field for the given day.

    Beanie encodes `datetime.date` as a BSON datetime at midnight with no offset
    applied, so a log dated 2026-08-13 lands on 2026-08-13T00:00:00Z whoever
    submitted it. Both ends therefore have to be built in UTC, not in the
    facility zone — doing the latter would slide the window by the offset and
    match the wrong day's logs.
    """
    start = datetime.combine(day, time.min, tzinfo=UTC)
    return start, start + timedelta(days=1)


def as_utc(value: datetime | None) -> datetime | None:
    """
    Stamp a datetime read back from Mongo as UTC.

    Motor returns naive datetimes for documents written without tzinfo, and
    comparing one of those against an aware `now()` raises. Everything stored is
    UTC, so attaching the offset is the correct reading rather than a guess.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
