from fastapi import HTTPException
from ..models.user import User, RoleEnum, StatusEnum
from ..models.audit_log import AuditLog
from ..schemas.auth import (
    SignupRequest, LoginRequest, MeResponse,
    ChangePasswordRequest, ChangeEmailRequest
)
from ..core.security import hash_password, verify_password, create_access_token
from ..repositories.user_repository import UserRepository
from ..repositories.audit_repository import AuditRepository

class AuthService:
    """Service layer for Authentication and User Onboarding."""

    @staticmethod
    async def signup(body: SignupRequest) -> str:
        if body.requested_role == RoleEnum.super_admin:
            raise HTTPException(400, "Cannot self-register as super_admin")
        
        existing = await UserRepository.get_by_email(body.email)
        if existing:
            raise HTTPException(409, "Email already registered")
            
        user = User(
            email=body.email,
            password_hash=hash_password(body.password),
            first_name=body.first_name,
            last_name=body.last_name,
            requested_role=body.requested_role,
            status=StatusEnum.pending,
        )
        await UserRepository.insert(user)
        
        await AuditRepository.insert(AuditLog(
            actor_id=str(user.id), 
            actor_role="none", 
            action="user_signup",
            entity_type="user", 
            entity_id=str(user.id),
            after=body.model_dump(exclude={"password"})
        ))
        
        return str(user.id)

    @staticmethod
    async def login(body: LoginRequest) -> tuple[str, str, str]:
        """Returns access_token, role, status"""
        user = await UserRepository.get_by_email(body.email)
        if not user or not verify_password(body.password, user.password_hash):
            if user:
                await AuditRepository.insert(AuditLog(
                    actor_id=str(user.id),
                    actor_role=user.role.value if user.role else "none",
                    action="login_failed",
                    entity_type="user",
                    entity_id=str(user.id),
                    before={"email": body.email, "reason": "Invalid credentials"}
                ))
            raise HTTPException(401, "Invalid credentials")
            
        if user.status == StatusEnum.pending:
            await AuditRepository.insert(AuditLog(
                actor_id=str(user.id),
                actor_role=user.role.value if user.role else "none",
                action="login_blocked",
                entity_type="user",
                entity_id=str(user.id),
                before={"email": body.email, "status": "pending"}
            ))
            raise HTTPException(403, "Your account is pending approval by an administrator.")
        if user.status == StatusEnum.rejected:
            await AuditRepository.insert(AuditLog(
                actor_id=str(user.id),
                actor_role=user.role.value if user.role else "none",
                action="login_blocked",
                entity_type="user",
                entity_id=str(user.id),
                before={"email": body.email, "status": "rejected"}
            ))
            raise HTTPException(403, "Your account was rejected. Kindly contact your administrator.")
        if user.status == StatusEnum.suspended:
            await AuditRepository.insert(AuditLog(
                actor_id=str(user.id),
                actor_role=user.role.value if user.role else "none",
                action="login_blocked",
                entity_type="user",
                entity_id=str(user.id),
                before={"email": body.email, "status": "suspended"}
            ))
            raise HTTPException(403, "Your account has been suspended. Kindly contact your superior to uplift the suspension.")

            
        token = create_access_token(str(user.id), user.role.value, body.remember_me)

        await AuditRepository.insert(AuditLog(
            actor_id=str(user.id),
            actor_role=user.role.value,
            action="login",
            entity_type="user",
            entity_id=str(user.id),
            after={"remember_me": body.remember_me}
        ))
        
        return token, user.role.value, user.status.value

    @staticmethod
    async def logout(current_user: User) -> None:
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action="logout",
            entity_type="user",
            entity_id=str(current_user.id)
        ))

    @staticmethod
    async def get_me(current_user: User) -> MeResponse:
        from beanie import PydanticObjectId
        from ..models.facility import Tank, Room, Facility
        from ..schemas.auth import AssignedTankDetail

        assigned_tanks: list[AssignedTankDetail] = []
        if current_user.assigned_tank_ids:
            valid_ids = [PydanticObjectId(tid) for tid in current_user.assigned_tank_ids if PydanticObjectId.is_valid(tid)]
            if valid_ids:
                tanks = await Tank.find({"_id": {"$in": valid_ids}, "deleted": False}).to_list()
                room_ids = [PydanticObjectId(t.room_id) for t in tanks if t.room_id and PydanticObjectId.is_valid(t.room_id)]
                rooms = await Room.find({"_id": {"$in": room_ids}}).to_list() if room_ids else []
                room_map = {str(r.id): r for r in rooms}

                fac_ids = [PydanticObjectId(r.facility_id) for r in rooms if r.facility_id and PydanticObjectId.is_valid(r.facility_id)]
                facilities = await Facility.find({"_id": {"$in": fac_ids}}).to_list() if fac_ids else []
                facility_map = {str(f.id): f.name for f in facilities}

                for t in tanks:
                    r = room_map.get(t.room_id)
                    fac_name = facility_map.get(r.facility_id) if r else None
                    assigned_tanks.append(AssignedTankDetail(
                        id=str(t.id),
                        tank_number=t.tank_number,
                        room_number=r.room_number if r else None,
                        facility_name=fac_name,
                        status=t.status
                    ))

        return MeResponse(
            id=str(current_user.id),
            email=current_user.email,
            first_name=current_user.first_name,
            last_name=current_user.last_name,
            role=current_user.role.value if current_user.role else None,
            status=current_user.status.value,
            email_notifications_enabled=getattr(current_user, 'email_notifications_enabled', True),
            assigned_tank_ids=current_user.assigned_tank_ids,
            assigned_tanks=assigned_tanks,
            created_at=current_user.created_at.isoformat() if current_user.created_at else None
        )

    @staticmethod
    async def update_email_notifications(current_user: User, enabled: bool) -> dict:
        MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}
        if not current_user.role or current_user.role not in MANAGER_PLUS:
            raise HTTPException(403, "Only managers and higher roles can change email notification preferences")

        old_val = getattr(current_user, 'email_notifications_enabled', True)
        current_user.email_notifications_enabled = enabled
        await current_user.save()

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action="update_email_notifications",
            entity_type="user",
            entity_id=str(current_user.id),
            before={"email_notifications_enabled": old_val},
            after={"email_notifications_enabled": enabled}
        ))

        return {
            "message": "Email notification settings updated successfully",
            "email_notifications_enabled": current_user.email_notifications_enabled
        }

    @staticmethod
    async def change_password(current_user: User, body: ChangePasswordRequest) -> dict:
        if not verify_password(body.old_password, current_user.password_hash):
            raise HTTPException(400, "Incorrect current password")

        if body.new_password != body.confirm_password:
            raise HTTPException(400, "New passwords do not match")

        if body.old_password == body.new_password:
            raise HTTPException(400, "New password cannot be the same as your current password")

        if len(body.new_password) < 6:
            raise HTTPException(400, "New password must be at least 6 characters long")

        current_user.password_hash = hash_password(body.new_password)
        await current_user.save()

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action="change_password",
            entity_type="user",
            entity_id=str(current_user.id)
        ))

        return {"message": "Password changed successfully"}

    @staticmethod
    async def change_email(current_user: User, body: ChangeEmailRequest) -> dict:
        if not verify_password(body.current_password, current_user.password_hash):
            raise HTTPException(400, "Incorrect password")

        new_email_clean = body.new_email.lower().strip()
        if new_email_clean == current_user.email.lower():
            raise HTTPException(400, "New email address must be different from your current email address")

        existing = await UserRepository.get_by_email(new_email_clean)
        if existing and str(existing.id) != str(current_user.id):
            raise HTTPException(409, "An account with this email address already exists")

        old_email = current_user.email
        current_user.email = new_email_clean
        await current_user.save()

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action="change_email",
            entity_type="user",
            entity_id=str(current_user.id),
            before={"email": old_email},
            after={"email": current_user.email}
        ))

        return {"message": "Email address updated successfully", "email": current_user.email}

    @staticmethod
    async def verify_password_current(current_user: User, password: str) -> dict:
        if not verify_password(password, current_user.password_hash):
            raise HTTPException(400, "Incorrect password")
        return {"valid": True}


