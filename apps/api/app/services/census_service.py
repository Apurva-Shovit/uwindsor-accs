from typing import List, Dict, Any, Optional
from datetime import date, datetime, timedelta, timezone
from fastapi import HTTPException, status

from ..models.user import User, RoleEnum
from ..models.audit_log import AuditLog
from ..models.project import Project
from ..models.facility import Tank
from ..models.tank_assignment import TankAssignment
from ..models.census_event import CensusEvent
from ..models.water_quality_log import WaterQualityLog
from ..models.incident_report import IncidentReport
from ..schemas.census import CensusEventCreate
from ..repositories.audit_repository import AuditRepository
from ..utils.atomic import adjust_count
from ..utils.entity_resolver import EntityResolver

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}

class CensusService:
    """Service layer for Census Event Management."""

    @staticmethod
    def _authorize_tank(user: User, tank_id: str) -> None:
        if user.role in MANAGER_PLUS:
            return
        if tank_id not in (user.assigned_tank_ids or []):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised to log for this tank")

    @staticmethod
    async def create_census_event(body: CensusEventCreate, current_user: User) -> Dict[str, Any]:
        ta = await TankAssignment.get(body.tank_assignment_id)
        if not ta:
            raise HTTPException(404, "Tank assignment not found")

        CensusService._authorize_tank(current_user, ta.tank_id)

        p = await Project.get(ta.project_id)
        if not p:
            raise HTTPException(404, "Associated Project not found")

        if p.status == "closed":
            raise HTTPException(status.HTTP_409_CONFLICT, "Project Closed")

        # The count is applied by the database, not computed here: two staff
        # logging deaths on the same tank at once both read the same starting
        # value, so a Python-side add loses one of them. The same filter also
        # enforces the non-negative invariant that "new_count < 0" used to
        # check against an already-stale read.
        new_count = await adjust_count(ta.id, body.change)

        # Snapshot around what actually happened rather than around the value
        # read at the top of the request, so the audit trail stays truthful
        # when another write landed in between.
        ta.current_count = new_count - body.change
        before_ta = ta.model_dump(mode="json")
        ta.current_count = new_count
        after_ta = ta.model_dump(mode="json")

        ev = CensusEvent(
            project_id=ta.project_id,
            tank_assignment_id=str(ta.id),
            tank_id=ta.tank_id,
            date=body.date or date.today(),
            event_type=body.event_type,
            change=body.change,
            reason=body.reason,
            notes=body.notes,
            created_by=str(current_user.id),
        )
        await ev.insert()
        after_ev = ev.model_dump(mode="json")

        if body.event_type == "arrival":
            dest_tank = await Tank.get(ta.tank_id)
            if dest_tank:
                from ..utils.quarantine_utils import place_quarantine
                actor_role = str(current_user.role.value if current_user.role else "none")
                await place_quarantine(
                    tank=dest_tank,
                    project_id=ta.project_id,
                    tank_assignment_id=str(ta.id),
                    actor_id=str(current_user.id),
                    actor_role=actor_role,
                    event_date=body.date or date.today(),
                    notes=body.notes,
                )

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=str(current_user.role.value if current_user.role else "none"),
            action="update",
            entity_type="tank_assignment",
            entity_id=str(ta.id),
            before=before_ta,
            after=after_ta,
        ))
        
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=str(current_user.role.value if current_user.role else "none"),
            action="create",
            entity_type="census_event",
            entity_id=str(ev.id),
            before=None,
            after=after_ev,
        ))

        return {"message": "Census recorded", "new_count": new_count}

    @staticmethod
    async def get_tank_assignment_history(assignment_id: str, current_user: User) -> List[Dict[str, Any]]:
        ta = await TankAssignment.get(assignment_id)
        if not ta:
            raise HTTPException(404, "Tank assignment not found")

        CensusService._authorize_tank(current_user, ta.tank_id)

        events = await CensusEvent.find({"tank_assignment_id": assignment_id}).to_list()
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

        history.sort(key=lambda x: x["created_at"], reverse=True)

        user_ids = {item["created_by"] for item in history if item.get("created_by")}
        user_map = await EntityResolver.resolve_users_by_ids(list(user_ids))

        for item in history:
            uid = item.get("created_by")
            if uid:
                item["created_by"] = user_map.get(uid, uid)

        return history

    @staticmethod
    async def list_tank_assignments(tank_id: Optional[str], current_user: User) -> List[TankAssignment]:
        query = {}
        if tank_id:
            query["tank_id"] = tank_id
        assignments = await TankAssignment.find(query).to_list()
        
        if current_user.role == RoleEnum.staff:
            assignments = [a for a in assignments if a.tank_id in (current_user.assigned_tank_ids or [])]
        return assignments
