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

        if source_ta.current_count < body.count:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Transfer count exceeds current count")

        dest_ta = await TankAssignment.find_one({
            "tank_id": body.destination_tank_id,
            "current_count": {"$gt": 0}
        })

        dest_is_new = False
        if dest_ta:
            if dest_ta.project_id != source_ta.project_id:
                raise HTTPException(status.HTTP_409_CONFLICT, "Destination tank is occupied by a different AUPP project")
        else:
            dest_is_new = True
            dest_ta = TankAssignment(
                project_id=source_ta.project_id,
                tank_id=body.destination_tank_id,
                current_count=0,
                pi_name=source_ta.pi_name,
                aupp_number=source_ta.aupp_number,
                created_by=str(current_user.id),
            )

        transfer_group_id = str(uuid.uuid4())

        if dest_is_new:
            await dest_ta.insert()

        before_source = source_ta.model_dump(mode="json")
        source_ta.current_count -= body.count
        await source_ta.save()
        after_source = source_ta.model_dump(mode="json")

        before_dest = dest_ta.model_dump(mode="json") if not dest_is_new else None
        dest_ta.current_count += body.count
        await dest_ta.save()
        after_dest = dest_ta.model_dump(mode="json")

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
            created_by=str(current_user.id),
        )
        await ev_out.insert()

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
        await ev_in.insert()

        if source_tank_obj and source_tank_obj.is_quarantined and dest_tank_obj:
            if not dest_tank_obj.is_quarantined:
                dest_tank_obj.is_quarantined = True
                dest_tank_obj.quarantine_start_date = source_tank_obj.quarantine_start_date
                dest_tank_obj.quarantine_end_date = source_tank_obj.quarantine_end_date
                await dest_tank_obj.save()

        actor_role = str(current_user.role.value if current_user.role else "none")

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
