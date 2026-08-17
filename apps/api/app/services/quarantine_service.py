import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, date
from fastapi import HTTPException
from pydantic import AliasChoices, BaseModel, Field
from ..models.user import User, RoleEnum
from ..models.audit_log import AuditLog
from ..models.facility import Tank
from ..models.quarantine import QuarantineExemption
from ..models.tank_assignment import TankAssignment
from ..models.census_event import CensusEvent
from ..repositories.audit_repository import AuditRepository

class ExemptionRequestCreate(BaseModel):
    tank_id: str
    target_tank_id: str
    # Named to match the stored document and the list response; "count" stays
    # accepted so already-deployed clients keep working.
    fish_count: int = Field(gt=0, validation_alias=AliasChoices("fish_count", "count"))
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
            fish_count=body.fish_count,
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
    async def list_exemptions(
        status_filter: Optional[str],
        current_user: User,
        page: int = 1,
        limit: int = 20,
    ) -> Dict[str, Any]:
        query: dict = {}
        if status_filter:
            query["status"] = status_filter

        if current_user.role == RoleEnum.staff:
            query["requested_by"] = str(current_user.id)

        skip = (page - 1) * limit
        total = await QuarantineExemption.find(query).count()
        exemptions = await QuarantineExemption.find(query).sort("-requested_at").skip(skip).limit(limit).to_list()

        from ..utils.entity_resolver import EntityResolver
        user_ids = []
        for ex in exemptions:
            if ex.requested_by:
                user_ids.append(ex.requested_by)
            if ex.decided_by:
                user_ids.append(ex.decided_by)

        user_names_map = await EntityResolver.resolve_users_by_ids(user_ids)

        items = []
        for ex in exemptions:
            d = ex.model_dump(mode="json")
            d["id"] = str(ex.id)
            d["requested_by_name"] = user_names_map.get(ex.requested_by) or ex.requested_by
            d["decided_by_name"] = user_names_map.get(ex.decided_by) if ex.decided_by else None
            items.append(d)

        total_pages = (total + limit - 1) // limit if limit > 0 else 1
        return {"items": items, "total": total, "page": page, "limit": limit, "total_pages": total_pages}

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

            actor_role = current_user.role.value if current_user.role else "none"

            before_source = source_ta.model_dump(mode="json")
            source_ta.current_count -= ex.fish_count
            await source_ta.save()

            await AuditRepository.insert(AuditLog(
                actor_id=str(current_user.id),
                actor_role=actor_role,
                action="update",
                entity_type="tank_assignment",
                entity_id=str(source_ta.id),
                before=before_source,
                after=source_ta.model_dump(mode="json"),
            ))

            before_dest = dest_ta.model_dump(mode="json") if not dest_is_new else None
            dest_ta.current_count += ex.fish_count
            await dest_ta.save()

            await AuditRepository.insert(AuditLog(
                actor_id=str(current_user.id),
                actor_role=actor_role,
                action="create" if dest_is_new else "update",
                entity_type="tank_assignment",
                entity_id=str(dest_ta.id),
                before=before_dest,
                after=dest_ta.model_dump(mode="json"),
            ))

            # Ensure destination tank is NOT placed in quarantine status
            target_tank_obj = await Tank.get(ex.target_tank_id)
            if target_tank_obj and target_tank_obj.is_quarantined:
                before_target_tank = target_tank_obj.model_dump(mode="json")
                target_tank_obj.is_quarantined = False
                target_tank_obj.quarantine_start_date = None
                target_tank_obj.quarantine_end_date = None
                await target_tank_obj.save()

                await AuditRepository.insert(AuditLog(
                    actor_id=str(current_user.id),
                    actor_role=actor_role,
                    action="lifted_quarantine",
                    entity_type="tank",
                    entity_id=str(target_tank_obj.id),
                    before=before_target_tank,
                    after=target_tank_obj.model_dump(mode="json"),
                ))

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

                await AuditRepository.insert(AuditLog(
                    actor_id=str(current_user.id),
                    actor_role=actor_role,
                    action="create",
                    entity_type="census_event",
                    entity_id=str(q_ev.id),
                    before=None,
                    after=q_ev.model_dump(mode="json"),
                ))

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

            await AuditRepository.insert(AuditLog(
                actor_id=str(current_user.id),
                actor_role=actor_role,
                action="create",
                entity_type="census_event",
                entity_id=str(ev_out.id),
                before=None,
                after=ev_out.model_dump(mode="json"),
            ))

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

            await AuditRepository.insert(AuditLog(
                actor_id=str(current_user.id),
                actor_role=actor_role,
                action="create",
                entity_type="census_event",
                entity_id=str(ev_in.id),
                before=None,
                after=ev_in.model_dump(mode="json"),
            ))

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
