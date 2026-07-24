from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from ..models.user import User, RoleEnum, StatusEnum, AuditLog
from ..models.project import Project
from ..models.tank_assignment import TankAssignment
from ..models.facility import Tank
from ..models.incident_report import IncidentReport
from ..core.permissions import require_chair_or_admin, get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# Helper to count documents
async def _count(model, query: dict = None):
    return await model.find(query or {}).count()

@router.get("/summary")
async def get_dashboard_summary(current: User = Depends(require_chair_or_admin)):
    # Users
    total_active_users = await _count(User, {"status": StatusEnum.active.value})
    # Projects
    active_projects = await _count(Project, {"status": "active"})
    # Pending approvals (users with pending status)
    pending_approvals = await _count(User, {"status": "pending"})
    # Tank status distribution
    tanks = await Tank.find({"deleted": False}).to_list()
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
    recent_incidents = await IncidentReport.find({"date": {"$gte": seven_days_ago}}).count()

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

@router.get("/activity")
async def get_dashboard_activity(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current: User = Depends(require_chair_or_admin),
):
    skip = (page - 1) * page_size
    logs = await AuditLog.find({}).sort("-created_at").skip(skip).limit(page_size).to_list()
    # Resolve actor names
    actor_ids = {log.actor_id for log in logs}
    from bson import ObjectId
    obj_ids = []
    for aid in actor_ids:
        try:
            obj_ids.append(ObjectId(aid))
        except Exception:
            pass
    users = await User.find({"_id": {"$in": obj_ids}}).to_list()
    user_map = {str(u.id): f"{u.first_name} {u.last_name}" for u in users}
    result = []
    for log in logs:
        result.append({
            "actor_name": user_map.get(str(log.actor_id), "Unknown"),
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "created_at": log.created_at.isoformat(),
        })
    return result
