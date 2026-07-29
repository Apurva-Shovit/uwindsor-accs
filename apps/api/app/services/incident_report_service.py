from typing import List, Dict, Any, Optional
from fastapi import HTTPException, status
from ..models.user import User, RoleEnum
from ..models.audit_log import AuditLog
from ..models.incident_report import IncidentReport
from ..models.tank_assignment import TankAssignment
from ..schemas.incident_report import IncidentReportCreate
from ..repositories.audit_repository import AuditRepository

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}

class IncidentReportService:
    """Service layer for Incident Reports."""

    @staticmethod
    def _authorize(user: User, tank_id: str) -> None:
        if user.role in MANAGER_PLUS:
            return
        if tank_id not in (user.assigned_tank_ids or []):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised to log for this tank")

    @staticmethod
    async def _get_project_id(tank_id: str) -> Optional[str]:
        ta = await TankAssignment.find_one({"tank_id": tank_id, "current_count": {"$gt": 0}})
        return ta.project_id if ta else None

    @staticmethod
    async def create_report(body: IncidentReportCreate, current_user: User) -> Dict[str, Any]:
        IncidentReportService._authorize(current_user, body.tank_id)
        project_id = await IncidentReportService._get_project_id(body.tank_id)

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
            created_by=str(current_user.id),
        )
        await report.insert()

        after = report.model_dump(mode="json")
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=str(current_user.role.value if current_user.role else "none"),
            action="create",
            entity_type="incident_report",
            entity_id=str(report.id),
            before=None,
            after=after,
        ))
        
        return after

    @staticmethod
    async def list_reports(
        vet_contacted: Optional[bool],
        tank_id: Optional[str],
        current_user: User,
        page: int = 1,
        limit: int = 20,
    ) -> Dict[str, Any]:
        if current_user.role not in MANAGER_PLUS:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Managers and above only")

        query: dict = {}
        if vet_contacted is not None:
            query["vet_contacted"] = vet_contacted
        if tank_id:
            query["tank_id"] = tank_id

        skip = (page - 1) * limit
        total = await IncidentReport.find(query).count()
        items = await IncidentReport.find(query).sort("-created_at").skip(skip).limit(limit).to_list()
        total_pages = (total + limit - 1) // limit if limit > 0 else 1
        return {"items": items, "total": total, "page": page, "limit": limit, "total_pages": total_pages}
