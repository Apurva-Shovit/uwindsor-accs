"""Shared quarantine placement/release utilities to avoid duplication across services."""
from datetime import datetime, timedelta, timezone, date as date_type
from typing import Optional, Tuple
from ..models.facility import Tank
from ..models.census_event import CensusEvent
from ..models.audit_log import AuditLog
from ..models.tank_assignment import TankAssignment
from ..repositories.audit_repository import AuditRepository

# Releases triggered by the expiry sweep have no human actor. This is not an
# ObjectId, so EntityResolver passes it through verbatim and reports render it
# as-is rather than as "Unknown User".
SYSTEM_ACTOR_ID = "System"
SYSTEM_ACTOR_ROLE = "system"


def as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Mongo hands back naive datetimes that are really UTC; make that explicit.

    Without this, subtracting a stored date from ``datetime.now(timezone.utc)``
    raises "can't subtract offset-naive and offset-aware datetimes".
    """
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def format_duration(delta: timedelta) -> str:
    """Render a span as '13 days, 4 hrs' / '5 hrs, 12 mins' / '42 mins'.

    Days suppress the minutes component — at that scale the extra precision is
    noise in a report line.
    """
    total_seconds = int(delta.total_seconds())
    if total_seconds < 60:
        return "less than a minute"

    days, remainder = divmod(total_seconds, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes = remainder // 60

    parts = []
    if days:
        parts.append(f"{days} day{'s' if days != 1 else ''}")
    if hours:
        parts.append(f"{hours} hr{'s' if hours != 1 else ''}")
    if minutes and not days:
        parts.append(f"{minutes} min{'s' if minutes != 1 else ''}")

    return ", ".join(parts) if parts else "less than a minute"


def snapshot_datetime(snapshot: Optional[dict], key: str) -> Optional[datetime]:
    """Pull a datetime out of an audit log's JSON-dumped tank snapshot.

    Lifting clears the quarantine dates off the tank, so the audit ``before``
    payload is the only surviving record of the window that was cut short.
    """
    if not isinstance(snapshot, dict):
        return None
    raw = snapshot.get(key)
    if not raw:
        return None
    if isinstance(raw, datetime):
        return as_utc(raw)
    try:
        return as_utc(datetime.fromisoformat(str(raw).replace("Z", "+00:00")))
    except ValueError:
        return None


def _stamp(dt: Optional[datetime]) -> str:
    return as_utc(dt).strftime("%Y-%m-%d %H:%M UTC") if dt else "an unrecorded date"


def describe_lift(
    quarantine_end_date: Optional[datetime],
    lifted_at: datetime,
    *,
    automatic: bool,
    actor_name: Optional[str] = None,
    quarantine_start_date: Optional[datetime] = None,
) -> Tuple[str, str]:
    """Build the (reason, notes) pair recorded when a quarantine is released.

    An early release states how much of the window was forfeited, so a reviewer
    reading the report can tell a release that skipped a day from one that
    skipped a fortnight. Both used to record the same fixed sentence.
    """
    end = as_utc(quarantine_end_date)
    start = as_utc(quarantine_start_date)
    lifted_at = as_utc(lifted_at)
    remaining = end - lifted_at if end else None

    if automatic:
        span = format_duration(end - start) if (end and start) else None
        reason = "Quarantine Period Completed - Automatically Lifted"
        notes = (
            f"Quarantine window of {span} closed on {_stamp(end)}; tank released automatically."
            if span
            else f"Quarantine window closed on {_stamp(end)}; tank released automatically."
        )
        return reason, notes

    actor = actor_name or "an operator"

    if remaining is None:
        return (
            "Manually Lifted (No Scheduled End Date)",
            f"Quarantine manually lifted by {actor}. No end date was recorded for this window.",
        )

    if remaining.total_seconds() <= 0:
        return (
            "Manually Lifted After Quarantine Period Completed",
            f"Quarantine manually lifted by {actor}, {format_duration(-remaining)} "
            f"after the window closed on {_stamp(end)}.",
        )

    left = format_duration(remaining)
    return (
        f"Manually Lifted Prior to Expiration - {left} remaining",
        f"Quarantine manually lifted by {actor} with {left} still to run; "
        f"the window was scheduled to close on {_stamp(end)}.",
    )


async def place_quarantine(
    tank: Tank,
    project_id: str,
    tank_assignment_id: str,
    actor_id: str,
    actor_role: str,
    event_date: date_type | None = None,
    notes: str | None = None,
) -> None:
    """Place a tank into 14-day biosecurity quarantine and emit all required audit/census events."""
    now = datetime.now(timezone.utc)
    before_tank = tank.model_dump(mode="json")
    tank.is_quarantined = True
    tank.quarantine_start_date = now
    tank.quarantine_end_date = now + timedelta(days=14)
    await tank.save()

    await AuditRepository.insert(AuditLog(
        actor_id=actor_id,
        actor_role=actor_role,
        action="placed_in_quarantine",
        entity_type="tank",
        entity_id=str(tank.id),
        before=before_tank,
        after=tank.model_dump(mode="json"),
    ))

    await CensusEvent(
        project_id=project_id,
        tank_assignment_id=tank_assignment_id,
        tank_id=str(tank.id),
        date=event_date or date_type.today(),
        event_type="quarantine_placed",
        change=0,
        reason="Mandatory 14-day Biosecurity Quarantine Initiated",
        notes=notes or "Placed under 14-day quarantine upon intake arrival",
        created_by=actor_id,
    ).insert()


async def record_lift(
    tank: Tank,
    before_tank: dict,
    *,
    actor_id: str,
    actor_role: str,
    reason: str,
    notes: str,
    event_date: date_type | None = None,
) -> None:
    """Emit the audit log and census event for an already-applied quarantine release."""
    await AuditRepository.insert(AuditLog(
        actor_id=actor_id,
        actor_role=actor_role,
        action="lifted_quarantine",
        entity_type="tank",
        entity_id=str(tank.id),
        before=before_tank,
        after=tank.model_dump(mode="json"),
    ))

    # Census events belong to a project timeline, so a tank with no assignment
    # records the audit entry only.
    ta = await TankAssignment.find_one({"tank_id": str(tank.id), "current_count": {"$gt": 0}})
    if not ta:
        ta = await TankAssignment.find_one({"tank_id": str(tank.id)})

    if ta and ta.project_id:
        await CensusEvent(
            project_id=ta.project_id,
            tank_assignment_id=str(ta.id),
            tank_id=str(tank.id),
            date=event_date or date_type.today(),
            event_type="quarantine_lifted",
            change=0,
            reason=reason,
            notes=notes,
            created_by=actor_id,
        ).insert()


async def lift_quarantine(
    tank: Tank,
    *,
    actor_id: str,
    actor_role: str,
    actor_name: Optional[str] = None,
    now: Optional[datetime] = None,
) -> None:
    """Release a tank from quarantine on an operator's instruction, recording what was cut short."""
    now = now or datetime.now(timezone.utc)
    reason, notes = describe_lift(
        tank.quarantine_end_date,
        now,
        automatic=False,
        actor_name=actor_name,
        quarantine_start_date=tank.quarantine_start_date,
    )

    before_tank = tank.model_dump(mode="json")
    tank.is_quarantined = False
    tank.quarantine_start_date = None
    tank.quarantine_end_date = None
    await tank.save()

    await record_lift(
        tank,
        before_tank,
        actor_id=actor_id,
        actor_role=actor_role,
        reason=reason,
        notes=notes,
    )


async def lift_expired_quarantines(now: Optional[datetime] = None) -> int:
    """Release every tank whose quarantine window has closed, and report how many.

    There is no scheduler in this app, so expiry is evaluated lazily on the read
    paths that surface quarantine state. Each tank is claimed with a conditional
    update so two concurrent requests cannot both release the same tank.
    """
    now = now or datetime.now(timezone.utc)

    due = await Tank.find({
        "deleted": False,
        "is_quarantined": True,
        "quarantine_end_date": {"$ne": None, "$lte": now},
    }).to_list()

    lifted = 0
    for tank in due:
        before_tank = tank.model_dump(mode="json")
        end = as_utc(tank.quarantine_end_date)
        reason, notes = describe_lift(
            tank.quarantine_end_date,
            now,
            automatic=True,
            quarantine_start_date=tank.quarantine_start_date,
        )

        claimed = await Tank.get_motor_collection().update_one(
            {"_id": tank.id, "is_quarantined": True},
            {"$set": {
                "is_quarantined": False,
                "quarantine_start_date": None,
                "quarantine_end_date": None,
                "updated_at": now,
            }},
        )
        if claimed.modified_count == 0:
            continue  # another request released it first

        tank.is_quarantined = False
        tank.quarantine_start_date = None
        tank.quarantine_end_date = None
        tank.updated_at = now

        await record_lift(
            tank,
            before_tank,
            actor_id=SYSTEM_ACTOR_ID,
            actor_role=SYSTEM_ACTOR_ROLE,
            reason=reason,
            notes=notes,
            # Dated to the day the window actually closed, which may predate today
            # if nothing hit a read path in the meantime.
            event_date=end.date() if end else None,
        )
        lifted += 1

    return lifted
