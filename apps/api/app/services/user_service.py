from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from fastapi import HTTPException
from ..models.user import User, RoleEnum, StatusEnum
from ..models.audit_log import AuditLog
from ..models.facility import Tank
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
        elif current_user.role == RoleEnum.manager:
            query = {"status": "pending", "requested_role": "staff"}
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

        # Manager scope enforcement: Manager can ONLY approve Staff accounts
        if current_user.role == RoleEnum.manager:
            if body.role != RoleEnum.staff or target.requested_role != RoleEnum.staff:
                raise HTTPException(403, "Managers can only approve Staff accounts")
            body.role = RoleEnum.staff

        # Enforce approval hierarchy server-side
        if body.role in (RoleEnum.chair, RoleEnum.admin) and current_user.role != RoleEnum.super_admin:
            raise HTTPException(403, "Only Super Admin can approve Chair/Admin")
        if body.role == RoleEnum.manager and current_user.role not in (RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin):
            raise HTTPException(403, "Only Chair/Admin/Super Admin can approve Manager accounts")

        before = target.model_dump()
        target.role = body.role
        target.status = StatusEnum.active
        target.facility_ids = body.facility_ids
        target.room_ids = body.room_ids

        # If Manager, Admin, Chair, or Super Admin and no explicit tank IDs passed, automatically assign all active tanks
        if body.role in (RoleEnum.manager, RoleEnum.admin, RoleEnum.chair, RoleEnum.super_admin) and not body.assigned_tank_ids:
            all_tanks = await Tank.find({"deleted": False}).to_list()
            target.assigned_tank_ids = [str(t.id) for t in all_tanks]
        else:
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

        if current_user.role == RoleEnum.manager and target.requested_role != RoleEnum.staff and target.role != RoleEnum.staff:
            raise HTTPException(403, "Managers can only reject Staff account requests")
            
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
    async def list_all_users(
        status_filter: Optional[str],
        current_user: User,
        page: int = 1,
        limit: int = 20,
        search: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Base authorization scope
        base_scope: dict = {}
        if current_user.role == RoleEnum.manager:
            base_scope["$or"] = [
                {"role": RoleEnum.staff.value},
                {"requested_role": RoleEnum.staff.value}
            ]

        # Global Account Status Summary (unfiltered by search/status_filter, but scoped by role permissions)
        all_scoped_users = await User.find(base_scope).to_list()
        def get_status_str(u: User) -> str:
            st = getattr(u, "status", None)
            if hasattr(st, "value"):
                return str(st.value)
            return str(st) if st else "pending"

        active_count = sum(1 for u in all_scoped_users if get_status_str(u) == "active")
        pending_count = sum(1 for u in all_scoped_users if get_status_str(u) == "pending")
        suspended_count = sum(1 for u in all_scoped_users if get_status_str(u) == "suspended")
        total_count = len(all_scoped_users)

        summary = {
            "active": active_count,
            "pending": pending_count,
            "suspended": suspended_count,
            "total": total_count,
        }

        # Build query for filtered result listing
        and_clauses = []
        if base_scope:
            and_clauses.append(base_scope)

        if status_filter and status_filter != "all":
            and_clauses.append({"status": status_filter})

        if search and search.strip():
            term = search.strip()
            regex_term = {"$regex": term, "$options": "i"}
            and_clauses.append({
                "$or": [
                    {"first_name": regex_term},
                    {"last_name": regex_term},
                    {"email": regex_term}
                ]
            })

        query: dict = {}
        if len(and_clauses) == 1:
            query = and_clauses[0]
        elif len(and_clauses) > 1:
            query = {"$and": and_clauses}

        skip = (page - 1) * limit
        total = await User.find(query).count()
        users = await User.find(query).sort("-created_at").skip(skip).limit(limit).to_list()

        all_tanks = await Tank.find({"deleted": False}).to_list()
        all_tank_ids = [str(t.id) for t in all_tanks]

        items = []
        for u in users:
            assigned_ids = u.assigned_tank_ids or []
            if u.role in (RoleEnum.manager, RoleEnum.admin, RoleEnum.chair, RoleEnum.super_admin) and not assigned_ids:
                assigned_ids = all_tank_ids

            items.append({
                "id": str(u.id),
                "email": u.email,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "requested_role": u.requested_role.value if u.requested_role else None,
                "role": u.role.value if u.role else None,
                "status": u.status.value if u.status else "pending",
                "assigned_tank_ids": assigned_ids,
                "approved_by": u.approved_by,
                "approved_at": u.approved_at,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            })

        # Determine allowed assignable roles for current user
        if current_user.role == RoleEnum.super_admin:
            allowed_assignable_roles = [
                {"value": "staff", "label": "Staff / Technician"},
                {"value": "manager", "label": "Facility Manager"},
                {"value": "admin", "label": "Administrator"},
                {"value": "chair", "label": "ACC Chair"},
                {"value": "super_admin", "label": "Super Admin"}
            ]
        elif current_user.role in (RoleEnum.chair, RoleEnum.admin):
            allowed_assignable_roles = [
                {"value": "staff", "label": "Staff / Technician"},
                {"value": "manager", "label": "Facility Manager"},
                {"value": "admin", "label": "Administrator"},
                {"value": "chair", "label": "ACC Chair"}
            ]
        elif current_user.role == RoleEnum.manager:
            allowed_assignable_roles = [
                {"value": "staff", "label": "Staff / Technician"}
            ]
        else:
            allowed_assignable_roles = []

        total_pages = (total + limit - 1) // limit if limit > 0 else 1
        return {
            "items": items,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
            "summary": summary,
            "allowed_assignable_roles": allowed_assignable_roles
        }


    @staticmethod
    async def update_user_role(user_id: str, new_role: RoleEnum, current_user: User) -> Dict[str, Any]:
        if current_user.role == RoleEnum.manager:
            raise HTTPException(403, "Managers are not authorized to modify user roles")

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
    async def update_user_status(user_id: str, new_status: str | StatusEnum, current_user: User) -> Dict[str, Any]:
        target = await UserRepository.get_by_id(user_id)
        if not target:
            raise HTTPException(404, "User not found")

        status_enum = StatusEnum(new_status) if isinstance(new_status, str) else new_status

        if current_user.role == RoleEnum.manager:
            if target.role != RoleEnum.staff:
                raise HTTPException(403, "Managers can only suspend or reinstate Staff accounts")

        if target.role in (RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin) and current_user.role != RoleEnum.super_admin:
            raise HTTPException(403, "Only Super Admin can suspend/reinstate Chair/Admin/Super Admin")

        before = target.model_dump()
        target.status = status_enum
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
