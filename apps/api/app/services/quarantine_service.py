from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from fastapi import HTTPException
from pydantic import BaseModel
from ..models.user import User, RoleEnum, AuditLog
from ..models.facility import Tank
from ..models.quarantine import QuarantineExemption
from ..repositories.audit_repository import AuditRepository

class ExemptionRequestCreate(BaseModel):
    tank_id: str
    target_tank_id: str
    count: int
    reason: str
    urgency: str = "normal"

class ExemptionDecision(BaseModel):
    approved: bool
    rejection_reason: Optional[str] = None

class QuarantineService:
    """Service layer for Quarantine Exemptions."""

    @staticmethod
    async def create_exemption_request(body: ExemptionRequestCreate, current_user: User) -> QuarantineExemption:
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
            requested_by=str(current_user.id),
        )
        await exemption.insert()

        after = exemption.model_dump(mode="json")
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action="quarantine_exemption_request",
            entity_type="quarantine_exemption",
            entity_id=str(exemption.id),
            before=None,
            after=after,
        ))

        return exemption

    @staticmethod
    async def list_exemptions(status_filter: Optional[str], current_user: User) -> List[QuarantineExemption]:
        query: dict = {}
        if status_filter:
            query["status"] = status_filter

        if current_user.role == RoleEnum.staff:
            query["requested_by"] = str(current_user.id)

        exemptions = await QuarantineExemption.find(query).to_list()
        exemptions.sort(key=lambda x: x.requested_at, reverse=True)
        return exemptions

    @staticmethod
    async def decide_exemption(exemption_id: str, body: ExemptionDecision, current_user: User) -> QuarantineExemption:
        ex = await QuarantineExemption.get(exemption_id)
        if not ex:
            raise HTTPException(404, "Exemption request not found")

        if ex.status != "pending":
            raise HTTPException(400, "Exemption request has already been processed")

        before = ex.model_dump(mode="json")
        ex.status = "approved" if body.approved else "rejected"
        ex.decided_by = str(current_user.id)
        ex.decided_at = datetime.now(timezone.utc)
        
        if not body.approved and body.rejection_reason:
            ex.rejection_reason = body.rejection_reason

        await ex.save()
        after = ex.model_dump(mode="json")

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action="quarantine_exemption_approve" if body.approved else "quarantine_exemption_reject",
            entity_type="quarantine_exemption",
            entity_id=str(ex.id),
            before=before,
            after=after,
        ))

        return ex
