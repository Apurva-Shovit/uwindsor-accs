"""
Server-clock helpers.

Every time-of-day rule in the notification generator is defined against server
time, which is UTC in production. These wrappers exist so the intent is explicit
at the call site and so nothing reaches for a naive `datetime.now()`, which would
follow whatever zone the host happens to be in — a developer machine on EDT and
a Render container on UTC would then disagree about when a deadline passed.
"""
from datetime import date, datetime, time, timedelta, timezone

UTC = timezone.utc


def server_now() -> datetime:
    """Current instant on the server clock, always timezone-aware."""
    return datetime.now(UTC)


def server_today() -> date:
    return server_now().date()


def server_datetime(day: date, hour: int = 0, minute: int = 0) -> datetime:
    """A given wall-clock time on a server day, as an aware datetime."""
    return datetime.combine(day, time(hour=hour, minute=minute), tzinfo=UTC)


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """
    Range matching a stored `date` field for the given day.

    Beanie encodes `datetime.date` as a BSON datetime at midnight with no offset
    applied, so a log dated 2026-08-13 lands on 2026-08-13T00:00:00Z whoever
    submitted it. Both ends therefore have to be built in UTC.
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
