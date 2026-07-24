from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from .security import decode_access_token
from ..models.user import User, RoleEnum, StatusEnum

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    try:
        payload = decode_access_token(token)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = await User.get(payload["sub"])
    if not user or user.status != StatusEnum.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not active")
    return user

def require_roles(*roles: RoleEnum):
    async def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return user
    return checker

require_super_admin = require_roles(RoleEnum.super_admin)
require_chair_or_admin = require_roles(RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin)
require_manager_plus = require_roles(RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin)
require_any_active = get_current_user
