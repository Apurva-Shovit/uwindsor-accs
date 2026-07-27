from fastapi import APIRouter, Depends, Query
from datetime import datetime
from typing import Optional

from ..models.user import User, RoleEnum, AuditLog
from ..core.permissions import require_manager_plus

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
    current: User = Depends(require_manager_plus),
):
    from ..services.audit_service import AuditService
    
    return await AuditService.get_paginated_logs(
        actor_id=actor_id,
        entity_type=entity_type,
        action=action,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size
    )
