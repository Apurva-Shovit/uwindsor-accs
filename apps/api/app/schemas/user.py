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

# The three admin edits below each carry an optional "expected" value: what the
# admin's screen was showing when they made the change. When it is supplied the
# server refuses the write if the record has moved on, so two admins editing the
# same user find out instead of silently overwriting each other.
#
# Optional rather than required because the Android app ships as an OTA bundle:
# older bundles keep working against this API and simply get the previous
# last-write-wins behaviour on their own field.

class UserRoleUpdate(BaseModel):
    role: RoleEnum
    expected_role: Optional[RoleEnum] = None

class UserStatusUpdate(BaseModel):
    status: StatusEnum
    reason: Optional[str] = None
    expected_status: Optional[StatusEnum] = None

class UserTankAssignmentsUpdate(BaseModel):
    assigned_tank_ids: list[str] = []
    expected_tank_ids: Optional[list[str]] = None
