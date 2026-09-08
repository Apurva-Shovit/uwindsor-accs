from fastapi import APIRouter, Depends, status, Request, Response
from ..core.limiter import limiter
from ..config import settings
from ..models.user import User
from ..schemas.auth import (
    SignupRequest, LoginRequest, TokenResponse, MeResponse,
    ChangePasswordRequest, ChangeEmailRequest
)
from ..services.auth_service import AuthService
from ..core.permissions import get_current_user
from ..core.security import token_lifetime

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
        # Kept in step with the JWT's exp claim, so the cookie never outlives
        # the token it carries.
        max_age=int(token_lifetime(body.remember_me).total_seconds()),
    )
    return TokenResponse(access_token=token, role=role, status=user_status)

@router.post("/logout")
async def logout(response: Response, current: User = Depends(get_current_user)):
    await AuthService.logout(current)
    response.delete_cookie("access_token")
    return {"message": "Logged out"}

@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)):
    return await AuthService.get_me(user)

@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, current: User = Depends(get_current_user)):
    return await AuthService.change_password(current, body)

@router.post("/change-email")
async def change_email(body: ChangeEmailRequest, current: User = Depends(get_current_user)):
    return await AuthService.change_email(current, body)

