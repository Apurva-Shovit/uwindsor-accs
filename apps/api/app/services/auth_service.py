from fastapi import HTTPException
from ..models.user import User, RoleEnum, StatusEnum
from ..models.audit_log import AuditLog
from ..schemas.auth import SignupRequest, LoginRequest
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
            raise HTTPException(401, "Invalid credentials")
            
        if user.status == StatusEnum.pending:
            raise HTTPException(403, "Your account is pending approval by an administrator.")
        if user.status == StatusEnum.rejected:
            raise HTTPException(403, "Your account was rejected. Kindly contact your administrator.")
        if user.status == StatusEnum.suspended:
            raise HTTPException(403, "Your account has been suspended. Kindly contact your superior to uplift the suspension.")

            
        token = create_access_token(str(user.id), user.role.value)
        
        await AuditRepository.insert(AuditLog(
            actor_id=str(user.id), 
            actor_role=user.role.value, 
            action="login",
            entity_type="user", 
            entity_id=str(user.id)
        ))
        
        return token, user.role.value, user.status.value
