from typing import Optional
from pydantic import BaseModel, field_validator
from ..models.user import RoleEnum, StatusEnum
from ..utils.sanitization import sanitize_html

class ApproveRequest(BaseModel):
    role: RoleEnum                      # confirm/override requested_role
    facility_ids: list[str] = []
    room_ids: list[str] = []
    assigned_tank_ids: list[str] = []

class RejectRequest(BaseModel):
    reason: str

    @field_validator('reason')
    @classmethod
    def sanitize_strings(cls, v: str) -> str:
        return sanitize_html(v)

class PendingUserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    requested_role: str
    created_at: str

class UserRoleUpdate(BaseModel):
    role: RoleEnum

class UserStatusUpdate(BaseModel):
    status: StatusEnum
    reason: Optional[str] = None

class UserTankAssignmentsUpdate(BaseModel):
    assigned_tank_ids: list[str] = []
