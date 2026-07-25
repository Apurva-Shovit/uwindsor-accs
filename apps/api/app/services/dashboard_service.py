from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List
from ..models.user import User, StatusEnum
from ..models.project import Project
from ..models.facility import Tank
from ..models.incident_report import IncidentReport
from ..repositories.base_repository import BaseRepository
from ..services.audit_service import AuditService

class DashboardService:
    """Service layer for Dashboard Aggregations."""

    @staticmethod
    async def get_dashboard_summary() -> Dict[str, Any]:
        user_repo = BaseRepository(User)
        project_repo = BaseRepository(Project)
        tank_repo = BaseRepository(Tank)
        incident_repo = BaseRepository(IncidentReport)

        # Users
        users = await user_repo.find({"status": StatusEnum.active.value})
        total_active_users = len(users)
        
        # Projects
        projects = await project_repo.find({"status": "active"})
        active_projects = len(projects)
        
        # Pending approvals
        pending = await user_repo.find({"status": "pending"})
        pending_approvals = len(pending)
        
        # Tank status distribution
        tanks = await tank_repo.find({"deleted": False})
        healthy, quarantine, attention = 0, 0, 0
        for t in tanks:
            if t.status == "inactive":
                continue
            elif t.is_quarantined:
                quarantine += 1
            else:
                healthy += 1
                
        # Recent incidents (last 7 days)
        seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
        incidents = await incident_repo.find({"date": {"$gte": seven_days_ago}})
        recent_incidents = len(incidents)

        return {
            "users": total_active_users,
            "projects": active_projects,
            "pending_approvals": pending_approvals,
            "tank_status": {
                "healthy": healthy,
                "quarantine": quarantine,
                "attention": attention,
            },
            "recent_incidents": recent_incidents,
        }

    @staticmethod
    async def get_dashboard_activity(skip: int, limit: int) -> List[Dict[str, Any]]:
        # Reuse the existing robust AuditService which handles EntityResolver
        return await AuditService.get_audit_logs(skip, limit)
