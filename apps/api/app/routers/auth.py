from fastapi import APIRouter, Depends, status
from ..models.user import User
from ..schemas.auth import SignupRequest, LoginRequest, TokenResponse, MeResponse
from ..services.auth_service import AuthService
from ..core.permissions import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/signup", status_code=201)
async def signup(body: SignupRequest):
    user_id = await AuthService.signup(body)
    return {"message": "Signup received. Awaiting approval.", "id": user_id}

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    token, role, status = await AuthService.login(body)
    return TokenResponse(access_token=token, role=role, status=status)

@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)):
    return MeResponse(
        id=str(user.id), email=user.email, first_name=user.first_name,
        last_name=user.last_name, role=user.role.value if user.role else None,
        status=user.status.value, assigned_tank_ids=user.assigned_tank_ids,
    )
