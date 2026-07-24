from datetime import date, datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..models.user import User, AuditLog, RoleEnum
from ..models.project import Project
from ..models.facility import Tank
from ..models.tank_assignment import TankAssignment
from ..models.census_event import CensusEvent
from ..core.permissions import get_current_user

router = APIRouter(prefix="/intake", tags=["intake"])

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}


def _authorize_tank(user: User, tank_id: str) -> None:
    if user.role in MANAGER_PLUS:
        return
    if tank_id not in (user.assigned_tank_ids or []):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised to log for this tank")


async def _create_audit(
    action: str,
    entity_type: str,
    entity_id: str,
    before: Optional[dict],
    after: Optional[dict],
    actor: User,
    session=None,
) -> None:
    log = AuditLog(
        actor_id=str(actor.id),
        actor_role=str(actor.role),
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before,
        after=after,
    )
    await log.insert(session=session)


class IntakeRequest(BaseModel):
    tank_id: str
    project_id: str
    count: int
    event_type: str = "arrival"
    notes: Optional[str] = None


@router.post("", status_code=201)
async def create_fish_intake(
    body: IntakeRequest,
    current: User = Depends(get_current_user),
):
    if body.count <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Count must be greater than zero")

    _authorize_tank(current, body.tank_id)

    # Verify project is active
    p = await Project.get(body.project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    if p.status == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Project Closed")

    # Verify destination is not occupied by another project
    dest_ta = await TankAssignment.find_one({
        "tank_id": body.tank_id,
        "current_count": {"$gt": 0}
    })
    if dest_ta and dest_ta.project_id != body.project_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Destination Occupied")

    # Find or create tank assignment
    ta = await TankAssignment.find_one({
        "tank_id": body.tank_id,
        "project_id": body.project_id
    })

    is_new = False
    if not ta:
        is_new = True
        ta = TankAssignment(
            project_id=body.project_id,
            tank_id=body.tank_id,
            current_count=0,
            pi_name=p.pi_name,
            aupp_number=p.aupp_number,
            created_by=str(current.id),
        )
        await ta.insert()

    before_ta = ta.model_dump(mode="json") if not is_new else None
    ta.current_count += body.count
    await ta.save()
    after_ta = ta.model_dump(mode="json")

    # Apply automatic quarantine on arrival
    if body.event_type == "arrival":
        tank = await Tank.get(body.tank_id)
        if tank:
            tank.is_quarantined = True
            tank.quarantine_start_date = datetime.now(timezone.utc)
            from datetime import timedelta
            tank.quarantine_end_date = tank.quarantine_start_date + timedelta(days=14)
            await tank.save()

    # Create census event
    ev = CensusEvent(
        project_id=body.project_id,
        tank_assignment_id=str(ta.id),
        tank_id=body.tank_id,
        date=date.today(),
        event_type=body.event_type,
        change=body.count,
        notes=body.notes or f"Fish Intake {body.event_type}",
        created_by=str(current.id),
    )
    await ev.insert()

    # Audit
    await _create_audit("update" if not is_new else "create", "tank_assignment", str(ta.id), before_ta, after_ta, current)
    await _create_audit("create", "census_event", str(ev.id), None, ev.model_dump(mode="json"), current)

    return ta

