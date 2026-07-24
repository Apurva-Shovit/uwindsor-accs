from fastapi import APIRouter, Depends, Query
from datetime import datetime
from typing import Optional

from ..models.user import User, RoleEnum, AuditLog
from ..core.permissions import require_chair_or_admin

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])

@router.get("")
async def get_audit_logs(
    actor_id: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current: User = Depends(require_chair_or_admin),
):
    # Build query
    query: dict = {}
    if actor_id:
        query["actor_id"] = actor_id
    if entity_type:
        query["entity_type"] = entity_type
    if action:
        query["action"] = action
    if date_from or date_to:
        date_filter: dict = {}
        if date_from:
            date_filter["$gte"] = date_from
        if date_to:
            date_filter["$lte"] = date_to
        query["created_at"] = date_filter
    # Pagination
    skip = (page - 1) * page_size
    logs_cursor = AuditLog.find(query).sort("-created_at").skip(skip).limit(page_size)
    logs = await logs_cursor.to_list()
    users_list = await User.find_all().to_list()
    user_map = {str(u.id): f"{u.first_name} {u.last_name}" for u in users_list}
    from ..models.tank_assignment import TankAssignment
    from ..models.facility import Tank
    from ..models.project import Project
    from ..models.census_event import CensusEvent
    from ..models.water_quality_log import WaterQualityLog
    
    result = []
    for log in logs:
        display_id = str(log.entity_id)
        try:
            if log.entity_type == "tank":
                t = await Tank.get(log.entity_id)
                display_id = f"Tank {t.tank_number}" if t else display_id
            elif log.entity_type == "project":
                p = await Project.get(log.entity_id)
                display_id = f"Project '{p.title}'" if p else display_id
            elif log.entity_type == "user":
                u = await User.get(log.entity_id)
                display_id = f"{u.first_name} {u.last_name}" if u else display_id
            elif log.entity_type == "tank_assignment":
                ta = await TankAssignment.get(log.entity_id)
                if ta:
                    t = await Tank.get(ta.tank_id)
                    display_id = f"Assignment on Tank {t.tank_number if t else 'Unknown'}"
            elif log.entity_type == "census_event":
                ce = await CensusEvent.get(log.entity_id)
                if ce:
                    t = await Tank.get(ce.tank_id)
                    display_id = f"Census for Tank {t.tank_number if t else 'Unknown'}"
            elif log.entity_type == "water_quality_log":
                display_id = ""
        except Exception:
            pass

        action_label = log.action
        if action_label == "quarantine_toggle" and log.after:
            action_label = "placed_in_quarantine" if log.after.get("is_quarantined") else "lifted_quarantine"

        # Resolve created_by/updated_by in diff payloads
        resolved_before = None
        if log.before:
            resolved_before = dict(log.before)
            for k, v in resolved_before.items():
                if k in ("created_by", "updated_by") and isinstance(v, str):
                    resolved_before[k] = user_map.get(v, v)
        
        resolved_after = None
        if log.after:
            resolved_after = dict(log.after)
            for k, v in resolved_after.items():
                if k in ("created_by", "updated_by") and isinstance(v, str):
                    resolved_after[k] = user_map.get(v, v)

        result.append({
            "actor_name": user_map.get(str(log.actor_id), "Unknown"),
            "action": action_label,
            "entity_type": log.entity_type,
            "entity_id": display_id,
            "before": resolved_before,
            "after": resolved_after,
            "timestamp": log.created_at.isoformat(),
        })
    return result
