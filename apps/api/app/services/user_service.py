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

    @staticmethod
    async def list_all_users(status_filter: Optional[str], current_user: User) -> List[Dict[str, Any]]:
        query: dict = {}
        if status_filter:
            query["status"] = status_filter

        users = await UserRepository.find(query)
        result = []
        for u in sorted(users, key=lambda x: x.created_at, reverse=True):
            result.append({
                "id": str(u.id),
                "email": u.email,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "requested_role": u.requested_role.value if u.requested_role else None,
                "role": u.role.value if u.role else None,
                "status": u.status.value if u.status else "pending",
                "assigned_tank_ids": u.assigned_tank_ids or [],
                "approved_by": u.approved_by,
                "approved_at": u.approved_at,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            })
        return result

    @staticmethod
    async def update_user_role(user_id: str, new_role: RoleEnum, current_user: User) -> Dict[str, Any]:
        target = await UserRepository.get_by_id(user_id)
        if not target:
            raise HTTPException(404, "User not found")

        # Permission check: Only Super Admin can modify Chair/Admin/Super Admin roles
        if (new_role in (RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin) or target.role in (RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin)) and current_user.role != RoleEnum.super_admin:
            raise HTTPException(403, "Only Super Admin can manage Chair/Admin/Super Admin roles")

        before = target.model_dump()
        target.role = new_role
        await UserRepository.update(target)

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action="user_role_update",
            entity_type="user",
            entity_id=user_id,
            before=before,
            after=target.model_dump()
        ))
        return {"id": str(target.id), "role": target.role.value}

    @staticmethod
    async def update_user_status(user_id: str, new_status: StatusEnum, current_user: User) -> Dict[str, Any]:
        target = await UserRepository.get_by_id(user_id)
        if not target:
            raise HTTPException(404, "User not found")

        if target.role in (RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin) and current_user.role != RoleEnum.super_admin:
            raise HTTPException(403, "Only Super Admin can suspend/reinstate Chair/Admin/Super Admin")

        before = target.model_dump()
        target.status = new_status
        await UserRepository.update(target)

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action="user_status_update",
            entity_type="user",
            entity_id=user_id,
            before=before,
            after=target.model_dump()
        ))
        return {"id": str(target.id), "status": target.status.value}

    @staticmethod
    async def update_tank_assignments(user_id: str, assigned_tank_ids: List[str], current_user: User) -> Dict[str, Any]:
        target = await UserRepository.get_by_id(user_id)
        if not target:
            raise HTTPException(404, "User not found")

        before = target.model_dump()
        target.assigned_tank_ids = assigned_tank_ids
        await UserRepository.update(target)

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action="user_tank_assignments_update",
            entity_type="user",
            entity_id=user_id,
            before=before,
            after=target.model_dump()
        ))
        return {"id": str(target.id), "assigned_tank_ids": target.assigned_tank_ids}
