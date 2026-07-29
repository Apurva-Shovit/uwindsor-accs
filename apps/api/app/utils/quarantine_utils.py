"""Shared quarantine placement utility to avoid duplication across services."""
from datetime import datetime, timedelta, timezone, date as date_type
from ..models.facility import Tank
from ..models.census_event import CensusEvent
from ..models.audit_log import AuditLog
from ..repositories.audit_repository import AuditRepository

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
