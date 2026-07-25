from typing import List, Dict, Any
from datetime import datetime, timezone
from fastapi import HTTPException
from ..models.user import User, RoleEnum, StatusEnum, AuditLog
from ..schemas.user import ApproveRequest, RejectRequest, PendingUserResponse
from ..repositories.user_repository import UserRepository
from ..repositories.audit_repository import AuditRepository

class UserService:
    """Service layer for User Management."""

    @staticmethod
    async def get_pending_users(current_user: User) -> List[PendingUserResponse]:
        if current_user.role == RoleEnum.super_admin:
            query = {"status": "pending"}
        elif current_user.role in (RoleEnum.chair, RoleEnum.admin):
            query = {"status": "pending", "requested_role": {"$in": ["manager", "staff"]}}
        else:
            raise HTTPException(403, "Not authorized to view pending users")
            
        users = await UserRepository.find(query)
        return [PendingUserResponse(
            id=str(u.id), email=u.email, first_name=u.first_name, last_name=u.last_name,
            requested_role=u.requested_role.value, created_at=u.created_at.isoformat(),
        ) for u in users]

    @staticmethod
    async def approve_user(user_id: str, body: ApproveRequest, current_user: User) -> str:
        target = await UserRepository.get_by_id(user_id)
        if not target or target.status != StatusEnum.pending:
            raise HTTPException(404, "Pending user not found")

        # Enforce approval hierarchy server-side
        if body.role in (RoleEnum.chair, RoleEnum.admin) and current_user.role != RoleEnum.super_admin:
            raise HTTPException(403, "Only Super Admin can approve Chair/Admin")
        if body.role in (RoleEnum.manager, RoleEnum.staff) and current_user.role not in (
            RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin
        ):
            raise HTTPException(403, "Only Chair/Admin/Super Admin can approve Manager/Staff")

        before = target.model_dump()
        target.role = body.role
        target.status = StatusEnum.active
        target.facility_ids = body.facility_ids
        target.room_ids = body.room_ids
        target.assigned_tank_ids = body.assigned_tank_ids
        target.approved_by = str(current_user.id)
        target.approved_at = datetime.now(timezone.utc).isoformat()
        
        await UserRepository.update(target)

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id), 
            actor_role=current_user.role.value if current_user.role else "none", 
            action="user_approve",
            entity_type="user", 
            entity_id=user_id, 
            before=before, 
            after=target.model_dump()
        ))
        
        return target.role.value if target.role else "none"

    @staticmethod
    async def reject_user(user_id: str, body: RejectRequest, current_user: User) -> None:
        target = await UserRepository.get_by_id(user_id)
        if not target or target.status != StatusEnum.pending:
            raise HTTPException(404, "Pending user not found")
            
        before = target.model_dump()
        target.status = StatusEnum.rejected
        target.rejection_reason = body.reason
        
        await UserRepository.update(target)
        
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id), 
            actor_role=current_user.role.value if current_user.role else "none", 
            action="user_reject",
            entity_type="user", 
            entity_id=user_id, 
            before=before, 
            after=target.model_dump()
        ))
