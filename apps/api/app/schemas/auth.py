from pydantic import BaseModel, EmailStr
from ..models.user import RoleEnum

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    requested_role: RoleEnum   # chair | admin | manager | staff (NOT super_admin)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

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
