import uuid
from datetime import date, datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status

from ..models.user import User, AuditLog, RoleEnum
from ..models.project import Project
from ..models.facility import Tank
from ..models.tank_assignment import TankAssignment
from ..models.census_event import CensusEvent
from ..core.permissions import get_current_user
from ..schemas.transfer import TankTransferCreate

router = APIRouter(prefix="/tank-transfers", tags=["transfers"])

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


@router.post("", status_code=200)
async def create_tank_transfer(
    body: TankTransferCreate,
    current: User = Depends(get_current_user),
):
    # 1. Load source assignment
    source_ta = await TankAssignment.get(body.source_assignment_id)
    if not source_ta:
        raise HTTPException(404, "Source tank assignment not found")

    # Authorize source tank
    _authorize_tank(current, source_ta.tank_id)
    # Authorize destination tank
    _authorize_tank(current, body.destination_tank_id)

    # Verify source project status is active
    p = await Project.get(source_ta.project_id)
    if not p or p.status == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Project Closed")

    # Verify enough fish
    if source_ta.current_count < body.count:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Transfer count exceeds current count")

    # Find destination occupied status
    dest_ta = await TankAssignment.find_one({
        "tank_id": body.destination_tank_id,
        "current_count": {"$gt": 0}
    })

    dest_is_new = False
    if dest_ta:
        if dest_ta.project_id != source_ta.project_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Destination Occupied")
    else:
        # Case B: Destination empty. Create new assignment
        dest_is_new = True
        dest_ta = TankAssignment(
            project_id=source_ta.project_id,
            tank_id=body.destination_tank_id,
            current_count=0,
            pi_name=source_ta.pi_name,
            aupp_number=source_ta.aupp_number,
            created_by=str(current.id),
        )

    transfer_group_id = str(uuid.uuid4())

    # If new destination, insert it first
    if dest_is_new:
        await dest_ta.insert()

    # Update source assignment
    before_source = source_ta.model_dump(mode="json")
    source_ta.current_count -= body.count
    await source_ta.save()
    after_source = source_ta.model_dump(mode="json")

    # Update destination assignment
    before_dest = dest_ta.model_dump(mode="json") if not dest_is_new else None
    dest_ta.current_count += body.count
    await dest_ta.save()
    after_dest = dest_ta.model_dump(mode="json")

    # Look up actual Tank numbers for readable notes
    source_tank_obj = await Tank.get(source_ta.tank_id)
    dest_tank_obj = await Tank.get(body.destination_tank_id)
    source_tank_num = source_tank_obj.tank_number if source_tank_obj else "Unknown"
    dest_tank_num = dest_tank_obj.tank_number if dest_tank_obj else "Unknown"

    # Create Transfer Out Event
    ev_out = CensusEvent(
        project_id=source_ta.project_id,
        tank_assignment_id=str(source_ta.id),
        tank_id=source_ta.tank_id,
        date=date.today(),
        event_type="transfer_out",
        change=-body.count,
        notes=body.notes or f"Transferred to Tank {dest_tank_num}",
        transfer_group_id=transfer_group_id,
        created_by=str(current.id),
    )
    await ev_out.insert()

    # Create Transfer In Event
    ev_in = CensusEvent(
        project_id=source_ta.project_id,
        tank_assignment_id=str(dest_ta.id),
        tank_id=dest_ta.tank_id,
        date=date.today(),
        event_type="transfer_in",
        change=body.count,
        notes=body.notes or f"Transferred from Tank {source_tank_num}",
        transfer_group_id=transfer_group_id,
        created_by=str(current.id),
    )
    await ev_in.insert()

    # Create Audits
    await _create_audit("update", "tank_assignment", str(source_ta.id), before_source, after_source, current)
    await _create_audit("update" if not dest_is_new else "create", "tank_assignment", str(dest_ta.id), before_dest, after_dest, current)
    await _create_audit("create", "census_event", str(ev_out.id), None, ev_out.model_dump(mode="json"), current)
    await _create_audit("create", "census_event", str(ev_in.id), None, ev_in.model_dump(mode="json"), current)

    return {
        "message": "Transfer Complete",
        "source_count": source_ta.current_count,
        "destination_count": dest_ta.current_count,
        "transfer_group_id": transfer_group_id
    }

