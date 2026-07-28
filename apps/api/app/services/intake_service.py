from typing import Dict, Any, Optional
from datetime import date, datetime, timedelta, timezone
from fastapi import HTTPException, status
from pydantic import BaseModel
from ..models.user import User, AuditLog, RoleEnum
from ..models.project import Project
from ..models.facility import Tank
from ..models.tank_assignment import TankAssignment
from ..models.census_event import CensusEvent
from ..repositories.audit_repository import AuditRepository

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}

class IntakeRequest(BaseModel):
    tank_id: str
    project_id: str
    count: int
    event_type: str = "arrival"
    notes: Optional[str] = None

class IntakeService:
    """Service layer for Fish Intake."""

    @staticmethod
    def _authorize_tank(user: User, tank_id: str) -> None:
        if user.role in MANAGER_PLUS:
            return
        if tank_id not in (user.assigned_tank_ids or []):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised to log for this tank")

    @staticmethod
    async def create_fish_intake(body: IntakeRequest, current_user: User) -> Dict[str, Any]:
        if body.count <= 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Count must be greater than zero")

        IntakeService._authorize_tank(current_user, body.tank_id)

        p = await Project.get(body.project_id)
        if not p:
            raise HTTPException(404, "Project not found")
        if p.status == "closed":
            raise HTTPException(status.HTTP_409_CONFLICT, "Project Closed")

        dest_ta = await TankAssignment.find_one({
            "tank_id": body.tank_id,
            "current_count": {"$gt": 0}
        })
        if dest_ta and dest_ta.project_id != body.project_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Destination Occupied")

        ta = await TankAssignment.find_one({
            "tank_id": body.tank_id,
            "project_id": body.project_id
        })

        is_new = False
        if not ta:
            is_new = True
            ta = TankAssignment(
                project_id=body.project_id,
                tank_id=body.tank_id,
                current_count=0,
                pi_name=p.pi_name,
                aupp_number=p.aupp_number,
                created_by=str(current_user.id),
            )
            await ta.insert()

        before_ta = ta.model_dump(mode="json") if not is_new else None
        ta.current_count += body.count
        await ta.save()
        after_ta = ta.model_dump(mode="json")

        ev = CensusEvent(
            project_id=body.project_id,
            tank_assignment_id=str(ta.id),
            tank_id=body.tank_id,
            date=date.today(),
            event_type=body.event_type,
            change=body.count,
            reason="Hatch" if body.event_type == "hatch" else "Arrival",
            notes=body.notes,
            created_by=str(current_user.id),
        )
        await ev.insert()

        # Auto-activate mandatory 14-day quarantine mode on destination tank ONLY for arrival events (hatch events do NOT quarantine)
        if body.event_type == "arrival":
            dest_tank = await Tank.get(body.tank_id)
            if dest_tank:
                now = datetime.now(timezone.utc)
                before_tank = dest_tank.model_dump(mode="json")
                dest_tank.is_quarantined = True
                dest_tank.quarantine_start_date = now
                dest_tank.quarantine_end_date = now + timedelta(days=14)
                await dest_tank.save()

                actor_role = str(current_user.role.value if current_user.role else "none")
                await AuditRepository.insert(AuditLog(
                    actor_id=str(current_user.id),
                    actor_role=actor_role,
                    action="placed_in_quarantine",
                    entity_type="tank",
                    entity_id=str(dest_tank.id),
                    before=before_tank,
                    after=dest_tank.model_dump(mode="json"),
                ))

                # Emit explicit quarantine_placed CensusEvent for reports timeline
                q_ev = CensusEvent(
                    project_id=body.project_id,
                    tank_assignment_id=str(ta.id),
                    tank_id=body.tank_id,
                    date=date.today(),
                    event_type="quarantine_placed",
                    change=0,
                    reason="Mandatory 14-day Biosecurity Quarantine Initiated",
                    notes=body.notes or "Placed under 14-day quarantine upon intake arrival",
                    created_by=str(current_user.id),
                )
                await q_ev.insert()

        actor_role = str(current_user.role.value if current_user.role else "none")

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id), actor_role=actor_role, action="update" if not is_new else "create",
            entity_type="tank_assignment", entity_id=str(ta.id),
            before=before_ta, after=after_ta,
        ))
        
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id), actor_role=actor_role, action="create",
            entity_type="census_event", entity_id=str(ev.id),
            before=None, after=ev.model_dump(mode="json"),
        ))

        return {"message": "Intake completed", "new_count": ta.current_count}
