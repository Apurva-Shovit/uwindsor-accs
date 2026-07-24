from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from ..models.user import User, RoleEnum, StatusEnum, AuditLog
from ..schemas.user import ApproveRequest, RejectRequest, PendingUserResponse
from ..core.permissions import get_current_user

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/pending", response_model=list[PendingUserResponse])
async def list_pending(current: User = Depends(get_current_user)):
    # Super admin sees chair/admin pending requests (and everything, as superset)
    # Chair/Admin see manager/staff pending requests only
    if current.role == RoleEnum.super_admin:
        query = {"status": "pending"}
    elif current.role in (RoleEnum.chair, RoleEnum.admin):
        query = {"status": "pending", "requested_role": {"$in": ["manager", "staff"]}}
    else:
        raise HTTPException(403, "Not authorized to view pending users")
    users = await User.find(query).to_list()
    return [PendingUserResponse(
        id=str(u.id), email=u.email, first_name=u.first_name, last_name=u.last_name,
        requested_role=u.requested_role.value, created_at=u.created_at.isoformat(),
    ) for u in users]

@router.patch("/{user_id}/approve")
async def approve_user(user_id: str, body: ApproveRequest, current: User = Depends(get_current_user)):
    target = await User.get(user_id)
    if not target or target.status != StatusEnum.pending:
        raise HTTPException(404, "Pending user not found")

    # Enforce approval hierarchy server-side
    if body.role in (RoleEnum.chair, RoleEnum.admin) and current.role != RoleEnum.super_admin:
        raise HTTPException(403, "Only Super Admin can approve Chair/Admin")
    if body.role in (RoleEnum.manager, RoleEnum.staff) and current.role not in (
        RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin
    ):
        raise HTTPException(403, "Only Chair/Admin/Super Admin can approve Manager/Staff")

    before = target.model_dump()
    target.role = body.role
    target.status = StatusEnum.active
    target.facility_ids = body.facility_ids
    target.room_ids = body.room_ids
    target.assigned_tank_ids = body.assigned_tank_ids
    target.approved_by = str(current.id)
    target.approved_at = datetime.now(timezone.utc).isoformat()
    await target.save()

    await AuditLog(
        actor_id=str(current.id), actor_role=current.role.value, action="user_approve",
        entity_type="user", entity_id=user_id, before=before, after=target.model_dump()
    ).insert()
    return {"message": "User approved", "role": target.role.value}

@router.patch("/{user_id}/reject")
async def reject_user(user_id: str, body: RejectRequest, current: User = Depends(get_current_user)):
    target = await User.get(user_id)
    if not target or target.status != StatusEnum.pending:
        raise HTTPException(404, "Pending user not found")
    before = target.model_dump()
    target.status = StatusEnum.rejected
    target.rejection_reason = body.reason
    await target.save()
    await AuditLog(
        actor_id=str(current.id), actor_role=current.role.value, action="user_reject",
        entity_type="user", entity_id=user_id, before=before, after=target.model_dump()
    ).insert()
    return {"message": "User rejected"}
