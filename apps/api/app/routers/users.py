from typing import Optional
from fastapi import APIRouter, Depends, Query
from ..models.user import User
from ..schemas.user import (
    ApproveRequest, RejectRequest, PendingUserResponse,
    UserRoleUpdate, UserStatusUpdate, UserTankAssignmentsUpdate
)
from ..services.user_service import UserService
from ..core.permissions import get_current_user, require_chair_or_admin, require_manager_plus

router = APIRouter(prefix="/users", tags=["users"])

@router.get("")
async def list_all_users(
    status_filter: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current: User = Depends(require_manager_plus),
):
    return await UserService.list_all_users(status_filter, current, page=page, limit=limit)

@router.get("/pending", response_model=list[PendingUserResponse])
async def list_pending(current: User = Depends(require_manager_plus)):
    return await UserService.get_pending_users(current)

@router.patch("/{user_id}/approve")
async def approve_user(user_id: str, body: ApproveRequest, current: User = Depends(require_manager_plus)):
    role_value = await UserService.approve_user(user_id, body, current)
    return {"message": "User approved", "role": role_value}

@router.patch("/{user_id}/reject")
async def reject_user(user_id: str, body: RejectRequest, current: User = Depends(require_manager_plus)):
    await UserService.reject_user(user_id, body, current)
    return {"message": "User rejected"}

@router.patch("/{user_id}/role")
async def update_user_role(user_id: str, body: UserRoleUpdate, current: User = Depends(require_chair_or_admin)):
    return await UserService.update_user_role(user_id, body.role, current)

@router.patch("/{user_id}/status")
async def update_user_status(user_id: str, body: UserStatusUpdate, current: User = Depends(require_manager_plus)):
    return await UserService.update_user_status(user_id, body.status, current)

@router.patch("/{user_id}/tank-assignments")
async def update_tank_assignments(user_id: str, body: UserTankAssignmentsUpdate, current: User = Depends(require_manager_plus)):
    return await UserService.update_tank_assignments(user_id, body.assigned_tank_ids, current)
