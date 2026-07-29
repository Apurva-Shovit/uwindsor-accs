from fastapi import Depends, HTTPException, status, Cookie, Request

async def get_current_user(
    request: Request,
    access_token: str | None = Cookie(default=None)
) -> User:
    token = access_token
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]

    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

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
