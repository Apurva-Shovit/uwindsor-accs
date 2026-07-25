from fastapi import APIRouter, Depends
from ..models.user import User
from ..schemas.user import ApproveRequest, RejectRequest, PendingUserResponse
from ..services.user_service import UserService
from ..core.permissions import get_current_user

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/pending", response_model=list[PendingUserResponse])
async def list_pending(current: User = Depends(get_current_user)):
    return await UserService.get_pending_users(current)

@router.patch("/{user_id}/approve")
async def approve_user(user_id: str, body: ApproveRequest, current: User = Depends(get_current_user)):
    role_value = await UserService.approve_user(user_id, body, current)
    return {"message": "User approved", "role": role_value}

@router.patch("/{user_id}/reject")
async def reject_user(user_id: str, body: RejectRequest, current: User = Depends(get_current_user)):
    await UserService.reject_user(user_id, body, current)
    return {"message": "User rejected"}
