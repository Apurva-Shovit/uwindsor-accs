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
            "before": log.before,
            "after": log.after,
            "timestamp": log.created_at.isoformat(),
        })
    return result
