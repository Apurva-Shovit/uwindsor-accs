from datetime import date, datetime, timezone
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..models.user import User, AuditLog, RoleEnum
from ..models.water_quality_log import WaterQualityLog
from ..models.facility import Tank
from ..models.tank_assignment import TankAssignment
from ..core.permissions import get_current_user
from ..constants.water_quality import validate_parameters

router = APIRouter(prefix="/water-quality-logs", tags=["water-quality-logs"])

# ── helpers ──────────────────────────────────────────────────────────────────

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}


def _authorize(user: User, tank_id: str) -> None:
    """Raise 403 if the user may not log for this tank."""
    if user.role in MANAGER_PLUS:
        return
    if tank_id not in (user.assigned_tank_ids or []):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised to log for this tank")


async def _get_project_id(tank_id: str) -> Optional[str]:
    """
    Resolve the current project_id for a tank from its active TankAssignment.
    """
    ta = await TankAssignment.find_one({"tank_id": tank_id, "current_count": {"$gt": 0}})
    return ta.project_id if ta else None


async def _create_audit(entity_type: str, entity_id: str, after: dict, actor: User) -> None:
    log = AuditLog(
        actor_id=str(actor.id),
        actor_role=str(actor.role),
        action="create",
        entity_type=entity_type,
        entity_id=entity_id,
        before=None,
        after=after,
    )
    await log.insert()


# ── schemas ───────────────────────────────────────────────────────────────────

class WaterQualityCreate(BaseModel):
    tank_id: str
    type: Literal["daily", "test_strip"]
    date: date
    parameters: dict
    comments: Optional[str] = None


class WaterQualityBatchCreate(BaseModel):
    type: Literal["daily", "test_strip"]
    tank_ids: list[str]
    date: date
    parameters: dict
    comments: Optional[str] = None


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_water_quality_log(
    body: WaterQualityCreate,
    current: User = Depends(get_current_user),
):
    _authorize(current, body.tank_id)
    project_id = await _get_project_id(body.tank_id)

    log = WaterQualityLog(
        tank_id=body.tank_id,
        project_id=project_id,
        type=body.type,
        date=body.date,
        parameters=body.parameters,
        comments=body.comments,
        created_by=str(current.id),
    )
    await log.insert()

    after = log.model_dump(mode="json")
    await _create_audit("water_quality_log", str(log.id), after, current)

    validation = validate_parameters(body.type, body.parameters)
    return {"message": "created", "log": after, "validation": validation}


@router.post("/batch", status_code=201)
async def create_batch_water_quality_logs(
    body: WaterQualityBatchCreate,
    current: User = Depends(get_current_user),
):
    if not body.tank_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "tank_ids cannot be empty")

    # Validate all permissions first before inserting anything
    for tank_id in body.tank_ids:
        _authorize(current, tank_id)

    created_logs = []
    for tank_id in body.tank_ids:
        project_id = await _get_project_id(tank_id)
        log = WaterQualityLog(
            tank_id=tank_id,
            project_id=project_id,
            type=body.type,
            date=body.date,
            parameters=body.parameters,
            comments=body.comments,
            created_by=str(current.id),
        )
        await log.insert()
        after = log.model_dump(mode="json")
        await _create_audit("water_quality_log", str(log.id), after, current)
        created_logs.append(after)

    validation = validate_parameters(body.type, body.parameters)
    return {"created": len(created_logs), "logs": created_logs, "validation": validation}


@router.get("")
async def list_water_quality_logs(
    tank_id: Optional[str] = None,
    current: User = Depends(get_current_user),
):
    """Read logs for a specific tank. Used by tank drawer history."""
    query: dict = {}
    if tank_id:
        query["tank_id"] = tank_id
    # Scope staff to assigned tanks
    if current.role == RoleEnum.staff:
        if tank_id and tank_id not in (current.assigned_tank_ids or []):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised")
    logs = await WaterQualityLog.find(query).sort("-created_at").to_list()
    return logs
