from fastapi import APIRouter, Depends, status, Request, Response
from ..core.limiter import limiter
from ..config import settings
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
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def login(request: Request, response: Response, body: LoginRequest):
    token, role, user_status = await AuthService.login(body)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_HOURS * 3600,
    )
    return TokenResponse(access_token=token, role=role, status=user_status)

@router.post("/logout")
async def logout(response: Response, current: User = Depends(get_current_user)):
    await AuthService.logout(current)
    response.delete_cookie("access_token")
    return {"message": "Logged out"}

@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)):
    return MeResponse(
        id=str(user.id), email=user.email, first_name=user.first_name,
        last_name=user.last_name, role=user.role.value if user.role else None,
        status=user.status.value, assigned_tank_ids=user.assigned_tank_ids,
    )
