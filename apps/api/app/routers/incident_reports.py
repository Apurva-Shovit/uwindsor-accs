from datetime import date, datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..models.user import User, AuditLog, RoleEnum
from ..models.incident_report import IncidentReport
from ..core.permissions import get_current_user
from ..models.tank_assignment import TankAssignment

router = APIRouter(prefix="/incident-reports", tags=["incident-reports"])

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}


def _authorize(user: User, tank_id: str) -> None:
    if user.role in MANAGER_PLUS:
        return
    if tank_id not in (user.assigned_tank_ids or []):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised to log for this tank")


async def _get_project_id(tank_id: str) -> Optional[str]:
    ta = await TankAssignment.find_one({"tank_id": tank_id, "current_count": {"$gt": 0}})
    return ta.project_id if ta else None


async def _create_audit(entity_id: str, after: dict, actor: User) -> None:
    log = AuditLog(
        actor_id=str(actor.id),
        actor_role=str(actor.role),
        action="create",
        entity_type="incident_report",
        entity_id=entity_id,
        before=None,
        after=after,
    )
    await log.insert()


# ── schema ────────────────────────────────────────────────────────────────────

class IncidentReportCreate(BaseModel):
    tank_id: str
    tank_assignment_id: Optional[str] = None
    date: date
    problem: str
    comments: Optional[str] = None
    treatment: Optional[str] = None
    aquatic_condition_checked: bool = False
    vet_contacted: bool = False
    researcher_notified: bool = False


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_incident_report(
    body: IncidentReportCreate,
    current: User = Depends(get_current_user),
):
    _authorize(current, body.tank_id)
    project_id = await _get_project_id(body.tank_id)

    report = IncidentReport(
        project_id=project_id,
        tank_assignment_id=body.tank_assignment_id,
        tank_id=body.tank_id,
        date=body.date,
        problem=body.problem,
        comments=body.comments,
        treatment=body.treatment,
        aquatic_condition_checked=body.aquatic_condition_checked,
        vet_contacted=body.vet_contacted,
        researcher_notified=body.researcher_notified,
        created_by=str(current.id),
    )
    await report.insert()

    after = report.model_dump(mode="json")
    await _create_audit(str(report.id), after, current)
    return after


@router.get("")
async def list_incident_reports(
    vet_contacted: Optional[bool] = None,
    tank_id: Optional[str] = None,
    current: User = Depends(get_current_user),
):
    """Manager dashboard query: filter by vet_contacted, tank_id, etc."""
    if current.role not in MANAGER_PLUS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Managers and above only")

    query: dict = {}
    if vet_contacted is not None:
        query["vet_contacted"] = vet_contacted
    if tank_id:
        query["tank_id"] = tank_id

    reports = []
    for report in await IncidentReport.find(query).sort("-created_at").to_list():
        # Only include reports for tanks that have a TankAssignment with current_count > 0
        ta = await TankAssignment.find_one({"tank_id": report.tank_id, "current_count": {"$gt": 0}})
        if ta:
            reports.append(report)
    return reports
