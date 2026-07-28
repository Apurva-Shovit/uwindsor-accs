import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, date
from fastapi import HTTPException
from pydantic import BaseModel
from ..models.user import User, RoleEnum, AuditLog
from ..models.facility import Tank
from ..models.quarantine import QuarantineExemption
from ..models.tank_assignment import TankAssignment
from ..models.census_event import CensusEvent
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
    async def list_exemptions(status_filter: Optional[str], current_user: User) -> List[Dict[str, Any]]:
        query: dict = {}
        if status_filter:
            query["status"] = status_filter

        if current_user.role == RoleEnum.staff:
            query["requested_by"] = str(current_user.id)

        exemptions = await QuarantineExemption.find(query).to_list()
        exemptions.sort(key=lambda x: x.requested_at, reverse=True)

        from ..utils.entity_resolver import EntityResolver
        user_ids = []
        for ex in exemptions:
            if ex.requested_by:
                user_ids.append(ex.requested_by)
            if ex.decided_by:
                user_ids.append(ex.decided_by)

        user_names_map = await EntityResolver.resolve_users_by_ids(user_ids)

        result = []
        for ex in exemptions:
            d = ex.model_dump(mode="json")
            d["id"] = str(ex.id)
            d["requested_by_name"] = user_names_map.get(ex.requested_by) or ex.requested_by
            d["decided_by_name"] = user_names_map.get(ex.decided_by) if ex.decided_by else None
            result.append(d)
        return result

    @staticmethod
    async def decide_exemption(exemption_id: str, body: ExemptionDecision, current_user: User) -> QuarantineExemption:
        ex = await QuarantineExemption.get(exemption_id)
        if not ex:
            raise HTTPException(404, "Exemption request not found")

        if ex.status != "pending":
            raise HTTPException(400, "Exemption request has already been processed")

        before = ex.model_dump(mode="json")

        if body.approved:
            # Auto-execute transfer without placing target tank in quarantine
            source_ta = await TankAssignment.find_one({
                "tank_id": ex.tank_id,
                "current_count": {"$gt": 0}
            })
            if not source_ta:
                source_ta = await TankAssignment.find_one({"tank_id": ex.tank_id})

            if not source_ta or source_ta.current_count < ex.fish_count:
                raise HTTPException(400, f"Source tank does not have enough fish ({source_ta.current_count if source_ta else 0} available, {ex.fish_count} requested)")

            dest_ta = await TankAssignment.find_one({
                "tank_id": ex.target_tank_id,
                "current_count": {"$gt": 0}
            })

            dest_is_new = False
            if dest_ta:
                if dest_ta.project_id != source_ta.project_id:
                    raise HTTPException(409, "Destination tank is occupied by a different AUPP project")
            else:
                dest_is_new = True
                dest_ta = TankAssignment(
                    project_id=source_ta.project_id,
                    tank_id=ex.target_tank_id,
                    current_count=0,
                    pi_name=source_ta.pi_name,
                    aupp_number=source_ta.aupp_number,
                    created_by=str(current_user.id),
                )
                await dest_ta.insert()

            source_ta.current_count -= ex.fish_count
            await source_ta.save()

            dest_ta.current_count += ex.fish_count
            await dest_ta.save()

            # Ensure destination tank is NOT placed in quarantine status
            target_tank_obj = await Tank.get(ex.target_tank_id)
            if target_tank_obj and target_tank_obj.is_quarantined:
                target_tank_obj.is_quarantined = False
                target_tank_obj.quarantine_start_date = None
                target_tank_obj.quarantine_end_date = None
                await target_tank_obj.save()

                q_ev = CensusEvent(
                    project_id=source_ta.project_id,
                    tank_assignment_id=str(dest_ta.id),
                    tank_id=ex.target_tank_id,
                    date=date.today(),
                    event_type="quarantine_lifted",
                    change=0,
                    reason="Quarantine Exemption Approved & Cleared for Transfer",
                    notes=f"Exemption approved by {current_user.first_name} {current_user.last_name}",
                    created_by=str(current_user.id),
                )
                await q_ev.insert()

            # Generate Census Events for transfer audit
            transfer_group_id = str(uuid.uuid4())
            source_tank_obj = await Tank.get(ex.tank_id)
            source_tank_num = source_tank_obj.tank_number if source_tank_obj else "Unknown"
            dest_tank_num = target_tank_obj.tank_number if target_tank_obj else "Unknown"

            ev_out = CensusEvent(
                project_id=source_ta.project_id,
                tank_assignment_id=str(source_ta.id),
                tank_id=source_ta.tank_id,
                date=date.today(),
                event_type="transfer_out",
                change=-ex.fish_count,
                notes=f"Quarantine Exemption Approved: Transferred to Tank {dest_tank_num}",
                transfer_group_id=transfer_group_id,
                created_by=str(current_user.id),
            )
            await ev_out.insert()

            ev_in = CensusEvent(
                project_id=source_ta.project_id,
                tank_assignment_id=str(dest_ta.id),
                tank_id=dest_ta.tank_id,
                date=date.today(),
                event_type="transfer_in",
                change=ex.fish_count,
                notes=f"Quarantine Exemption Approved: Transferred from Tank {source_tank_num}",
                transfer_group_id=transfer_group_id,
                created_by=str(current_user.id),
            )
            await ev_in.insert()

            ex.status = "approved"
        else:
            ex.status = "rejected"
            if body.rejection_reason:
                ex.rejection_reason = body.rejection_reason

        ex.decided_by = str(current_user.id)
        ex.decided_at = datetime.now(timezone.utc)
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
