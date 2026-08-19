import uuid
from typing import Dict, Any
from datetime import date, datetime, timezone
from fastapi import HTTPException, status
from ..models.user import User, RoleEnum
from ..models.audit_log import AuditLog
from ..models.project import Project
from ..models.facility import Tank
from ..models.tank_assignment import TankAssignment
from ..models.census_event import CensusEvent
from ..schemas.transfer import TankTransferCreate
from ..repositories.audit_repository import AuditRepository
from ..utils.atomic import Compensation, adjust_count, claim_request_id, get_or_create_assignment

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}

class TransferService:
    """Service layer for Tank Transfers."""

    @staticmethod
    def _authorize_tank(user: User, tank_id: str) -> None:
        if user.role in MANAGER_PLUS:
            return
        if tank_id not in (user.assigned_tank_ids or []):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised to log for this tank")

    @staticmethod
    async def create_tank_transfer(body: TankTransferCreate, current_user: User) -> Dict[str, Any]:
        source_ta = await TankAssignment.get(body.source_assignment_id)
        if not source_ta:
            raise HTTPException(404, "Source tank assignment not found")

        TransferService._authorize_tank(current_user, source_ta.tank_id)
        TransferService._authorize_tank(current_user, body.destination_tank_id)

        p = await Project.get(source_ta.project_id)
        if not p or p.status == "closed":
            raise HTTPException(status.HTTP_409_CONFLICT, "Project Closed")

        # A friendly early rejection only. The authoritative stock check is the
        # filter inside adjust_count, because this one reads a value that two
        # concurrent transfers would both pass.
        if source_ta.current_count < body.count:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Transfer count exceeds current count")

        occupant = await TankAssignment.find_one({
            "tank_id": body.destination_tank_id,
            "current_count": {"$gt": 0}
        })
        if occupant and occupant.project_id != source_ta.project_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Destination tank is occupied by a different AUPP project")

        # Keyed on (tank_id, project_id) rather than on "whichever row happens
        # to hold fish", so it reuses an existing emptied row instead of
        # colliding with it under the unique index.
        dest_ta, dest_is_new = await get_or_create_assignment(
            body.destination_tank_id,
            source_ta.project_id,
            created_by=str(current_user.id),
            pi_name=source_ta.pi_name,
            aupp_number=source_ta.aupp_number,
        )

        transfer_group_id = str(uuid.uuid4())

        source_tank_obj = await Tank.get(source_ta.tank_id)
        dest_tank_obj = await Tank.get(body.destination_tank_id)
        source_tank_num = source_tank_obj.tank_number if source_tank_obj else "Unknown"
        dest_tank_num = dest_tank_obj.tank_number if dest_tank_obj else "Unknown"

        ev_out = CensusEvent(
            project_id=source_ta.project_id,
            tank_assignment_id=str(source_ta.id),
            tank_id=source_ta.tank_id,
            date=date.today(),
            event_type="transfer_out",
            change=-body.count,
            notes=body.notes or f"Transferred to Tank {dest_tank_num}",
            transfer_group_id=transfer_group_id,
            request_id=body.request_id,
            created_by=str(current_user.id),
        )

        ev_in = CensusEvent(
            project_id=source_ta.project_id,
            tank_assignment_id=str(dest_ta.id),
            tank_id=dest_ta.tank_id,
            date=date.today(),
            event_type="transfer_in",
            change=body.count,
            notes=body.notes or f"Transferred from Tank {source_tank_num}",
            transfer_group_id=transfer_group_id,
            created_by=str(current_user.id),
        )

        # Debit and credit are two separate writes with no transaction between
        # them, so a failure after the debit would destroy fish. Each step
        # registers its inverse as it succeeds; the failure path puts the
        # animals back rather than leaving them in neither tank.
        # The outbound leg carries the idempotency key and goes in first, so a
        # re-tap after a dropped response is recognised before anything moves.
        if await claim_request_id(ev_out) is None:
            # Report the transfer that already happened, including its own
            # group id -- the one generated above belongs to a move that will
            # never take place.
            original = await CensusEvent.find_one({"request_id": body.request_id})
            source_ta = await TankAssignment.get(source_ta.id)
            dest_ta = await TankAssignment.get(dest_ta.id)
            return {
                "message": "Transfer already completed",
                "source_count": source_ta.current_count,
                "destination_count": dest_ta.current_count,
                "transfer_group_id": original.transfer_group_id if original else transfer_group_id,
                "duplicate": True,
            }

        comp = Compensation()
        comp.add(ev_out.delete)
        try:
            new_source_count = await adjust_count(source_ta.id, -body.count)
            comp.add(lambda: adjust_count(source_ta.id, body.count, allow_negative=True))

            new_dest_count = await adjust_count(dest_ta.id, body.count)
            comp.add(lambda: adjust_count(dest_ta.id, -body.count, allow_negative=True))

            await ev_in.insert()
            comp.add(ev_in.delete)
        except Exception:
            await comp.rollback()
            raise

        source_ta.current_count = new_source_count + body.count
        before_source = source_ta.model_dump(mode="json")
        source_ta.current_count = new_source_count
        after_source = source_ta.model_dump(mode="json")

        dest_ta.current_count = new_dest_count - body.count
        before_dest = dest_ta.model_dump(mode="json") if not dest_is_new else None
        dest_ta.current_count = new_dest_count
        after_dest = dest_ta.model_dump(mode="json")

        actor_role = str(current_user.role.value if current_user.role else "none")

        if source_tank_obj and source_tank_obj.is_quarantined and dest_tank_obj:
            if not dest_tank_obj.is_quarantined:
                before_dest_tank = dest_tank_obj.model_dump(mode="json")
                dest_tank_obj.is_quarantined = True
                dest_tank_obj.quarantine_start_date = source_tank_obj.quarantine_start_date
                dest_tank_obj.quarantine_end_date = source_tank_obj.quarantine_end_date
                await dest_tank_obj.save()

                await AuditRepository.insert(AuditLog(
                    actor_id=str(current_user.id),
                    actor_role=actor_role,
                    action="placed_in_quarantine",
                    entity_type="tank",
                    entity_id=str(dest_tank_obj.id),
                    before=before_dest_tank,
                    after=dest_tank_obj.model_dump(mode="json")
                ))

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id), actor_role=actor_role, action="update",
            entity_type="tank_assignment", entity_id=str(source_ta.id),
            before=before_source, after=after_source,
        ))
        
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id), actor_role=actor_role, action="update" if not dest_is_new else "create",
            entity_type="tank_assignment", entity_id=str(dest_ta.id),
            before=before_dest, after=after_dest,
        ))
        
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id), actor_role=actor_role, action="create",
            entity_type="census_event", entity_id=str(ev_out.id),
            before=None, after=ev_out.model_dump(mode="json"),
        ))
        
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id), actor_role=actor_role, action="create",
            entity_type="census_event", entity_id=str(ev_in.id),
            before=None, after=ev_in.model_dump(mode="json"),
        ))

        return {
            "message": "Transfer Complete",
            "source_count": source_ta.current_count,
            "destination_count": dest_ta.current_count,
            "transfer_group_id": transfer_group_id
        }
