from datetime import date, datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..models.user import User, AuditLog, RoleEnum
from ..models.project import Project
from ..models.tank_assignment import TankAssignment
from ..models.census_event import CensusEvent
from ..models.water_quality_log import WaterQualityLog
from ..models.incident_report import IncidentReport
from ..core.permissions import get_current_user
from ..schemas.census import CensusEventCreate

router = APIRouter(tags=["census"])

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


@router.post("/census-events", status_code=201)
async def create_census_event(
    body: CensusEventCreate,
    current: User = Depends(get_current_user),
):
    # 1. Load TankAssignment
    ta = await TankAssignment.get(body.tank_assignment_id)
    if not ta:
        raise HTTPException(404, "Tank assignment not found")

    # 2. Staff authorization check
    _authorize_tank(current, ta.tank_id)

    # 3. Verify Project is Active
    p = await Project.get(ta.project_id)
    if not p:
        raise HTTPException(404, "Associated Project not found")

    if p.status == "closed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Project Closed")

    # 4. Validate current_count + change >= 0
    new_count = ta.current_count + body.change
    if new_count < 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Count")

    # 5. Execute operations sequentially
    # Update TankAssignment current_count
    before_ta = ta.model_dump(mode="json")
    ta.current_count = new_count
    await ta.save()
    after_ta = ta.model_dump(mode="json")

    # Create CensusEvent
    ev = CensusEvent(
        project_id=ta.project_id,
        tank_assignment_id=str(ta.id),
        tank_id=ta.tank_id,
        date=body.date or date.today(),
        event_type=body.event_type,
        change=body.change,
        reason=body.reason,
        notes=body.notes,
        created_by=str(current.id),
    )
    await ev.insert()
    after_ev = ev.model_dump(mode="json")

    # Create AuditLog entries
    await _create_audit("update", "tank_assignment", str(ta.id), before_ta, after_ta, current)
    await _create_audit("create", "census_event", str(ev.id), None, after_ev, current)

    return {"message": "Census recorded", "new_count": new_count}



@router.get("/tank-assignments/{id}/history")
async def get_tank_assignment_history(
    id: str,
    current: User = Depends(get_current_user),
):
    ta = await TankAssignment.get(id)
    if not ta:
        raise HTTPException(404, "Tank assignment not found")

    # Verify authorization
    _authorize_tank(current, ta.tank_id)

    # Gather chronological logs for this assignment's tank
    # 1. Census Events
    events = await CensusEvent.find({"tank_assignment_id": id}).to_list()
    history = []
    for ev in events:
        history.append({
            "type": "census",
            "event_type": ev.event_type,
            "change": ev.change,
            "reason": ev.reason,
            "notes": ev.notes,
            "transfer_group_id": ev.transfer_group_id,
            "date": str(ev.date),
            "created_by": ev.created_by,
            "created_at": ev.created_at.isoformat(),
        })

    # 2. Water Quality Logs
    wq = await WaterQualityLog.find({"tank_id": ta.tank_id}).to_list()
    for log in wq:
        history.append({
            "type": "water_quality",
            "log_type": log.type,
            "parameters": log.parameters,
            "comments": log.comments,
            "date": str(log.date),
            "created_by": log.created_by,
            "created_at": log.created_at.isoformat(),
        })

    # 3. Incident Reports
    incidents = await IncidentReport.find({"tank_id": ta.tank_id}).to_list()
    for inc in incidents:
        history.append({
            "type": "incident",
            "problem": inc.problem,
            "treatment": inc.treatment,
            "comments": inc.comments,
            "vet_contacted": inc.vet_contacted,
            "date": str(inc.date),
            "created_by": inc.created_by,
            "created_at": inc.created_at.isoformat(),
        })

    # Sort history: newest first (newest created_at first)
    history.sort(key=lambda x: x["created_at"], reverse=True)
    return history


@router.get("/tank-assignments")
async def list_tank_assignments(
    tank_id: Optional[str] = None,
    current: User = Depends(get_current_user),
):
    query = {}
    if tank_id:
        query["tank_id"] = tank_id
    assignments = await TankAssignment.find(query).to_list()
    if current.role == RoleEnum.staff:
        # filter to assigned tanks
        assignments = [a for a in assignments if a.tank_id in (current.assigned_tank_ids or [])]
    return assignments

