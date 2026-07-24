from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from typing import Optional

from ..models.user import User, RoleEnum, AuditLog
from ..models.facility import Tank
from ..models.quarantine import QuarantineExemption
from ..core.permissions import get_current_user, require_chair_or_admin

router = APIRouter(prefix="/quarantine", tags=["quarantine"])

class ExemptionRequestCreate(BaseModel):
    tank_id: str
    target_tank_id: str
    count: int
    reason: str
    urgency: str = "normal"

class ExemptionDecision(BaseModel):
    approved: bool
    rejection_reason: Optional[str] = None

@router.post("/exemption-request", status_code=201)
async def create_exemption_request(
    body: ExemptionRequestCreate,
    current: User = Depends(get_current_user),
):
    tank = await Tank.get(body.tank_id)
    if not tank:
        raise HTTPException(404, "Source tank not found")

    target_tank = await Tank.get(body.target_tank_id)
    if not target_tank:
        raise HTTPException(404, "Target tank not found")

    exemption = QuarantineExemption(
        tank_id=body.tank_id,
        target_tank_id=body.target_tank_id,
        fish_count=body.count,
        reason=body.reason,
        urgency=body.urgency,
        requested_by=str(current.id),
    )
    await exemption.insert()

    # Log audit event
    await AuditLog(
        actor_id=str(current.id),
        actor_role=current.role.value,
        action="quarantine_exemption_request",
        entity_type="quarantine_exemption",
        entity_id=str(exemption.id),
        after=exemption.model_dump(mode="json")
    ).insert()

    return exemption

@router.get("/exemptions")
async def list_exemptions(
    status_filter: Optional[str] = Query(None),
    current: User = Depends(get_current_user),
):
    query: dict = {}
    if status_filter:
        query["status"] = status_filter

    if current.role == RoleEnum.staff:
        query["requested_by"] = str(current.id)

    exemptions = await QuarantineExemption.find(query).to_list()
    exemptions.sort(key=lambda x: x.requested_at, reverse=True)
    return exemptions

@router.patch("/exemption/{id}/decide")
async def decide_exemption(
    id: str,
    body: ExemptionDecision,
    current: User = Depends(require_chair_or_admin),
):
    ex = await QuarantineExemption.get(id)
    if not ex:
        raise HTTPException(404, "Exemption request not found")

    if ex.status != "pending":
        raise HTTPException(400, "Exemption request has already been processed")

    before = ex.model_dump(mode="json")
    ex.status = "approved" if body.approved else "rejected"
    ex.decided_by = str(current.id)
    ex.decided_at = datetime.now(timezone.utc)
    if not body.approved and body.rejection_reason:
        ex.rejection_reason = body.rejection_reason

    await ex.save()

    await AuditLog(
        actor_id=str(current.id),
        actor_role=current.role.value,
        action="quarantine_exemption_approve" if body.approved else "quarantine_exemption_reject",
        entity_type="quarantine_exemption",
        entity_id=str(ex.id),
        before=before,
        after=ex.model_dump(mode="json")
    ).insert()

    return ex
