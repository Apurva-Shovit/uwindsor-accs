from pydantic import BaseModel, EmailStr, field_validator
from ..models.user import RoleEnum
from ..utils.sanitization import sanitize_html

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    requested_role: RoleEnum   # chair | admin | manager | staff (NOT super_admin)

    @field_validator('first_name', 'last_name')
    @classmethod
    def sanitize_strings(cls, v: str) -> str:
        return sanitize_html(v)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    # Opt-in: when false the session lasts ACCESS_TOKEN_EXPIRE_HOURS, when true
    # REMEMBER_ME_EXPIRE_DAYS. Defaulted so existing clients keep working.
    remember_me: bool = False

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    status: str

class MeResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str | None
    status: str
    assigned_tank_ids: list[str]
