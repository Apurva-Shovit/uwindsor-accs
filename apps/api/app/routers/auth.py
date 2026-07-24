from fastapi import APIRouter, HTTPException, Depends, status
from ..models.user import User, RoleEnum, StatusEnum, AuditLog
from ..schemas.auth import SignupRequest, LoginRequest, TokenResponse, MeResponse
from ..core.security import hash_password, verify_password, create_access_token
from ..core.permissions import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/signup", status_code=201)
async def signup(body: SignupRequest):
    if body.requested_role == RoleEnum.super_admin:
        raise HTTPException(400, "Cannot self-register as super_admin")
    existing = await User.find_one({"email": body.email})
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
    await user.insert()
    await AuditLog(
        actor_id=str(user.id), actor_role="none", action="user_signup",
        entity_type="user", entity_id=str(user.id),
        after=body.model_dump(exclude={"password"})
    ).insert()
    return {"message": "Signup received. Awaiting approval.", "id": str(user.id)}

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    user = await User.find_one({"email": body.email})
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    if user.status == StatusEnum.pending:
        raise HTTPException(403, "Account pending approval")
    if user.status == StatusEnum.rejected:
        raise HTTPException(403, "Account was rejected. Contact your administrator.")
    if user.status == StatusEnum.suspended:
        raise HTTPException(403, "Account suspended")
    token = create_access_token(str(user.id), user.role.value)
    await AuditLog(
        actor_id=str(user.id), actor_role=user.role.value, action="login",
        entity_type="user", entity_id=str(user.id)
    ).insert()
    return TokenResponse(access_token=token, role=user.role.value, status=user.status.value)

@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)):
    return MeResponse(
        id=str(user.id), email=user.email, first_name=user.first_name,
        last_name=user.last_name, role=user.role.value if user.role else None,
        status=user.status.value, assigned_tank_ids=user.assigned_tank_ids,
    )
