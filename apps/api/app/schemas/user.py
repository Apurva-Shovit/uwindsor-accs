from pydantic import BaseModel
from ..models.user import RoleEnum

class ApproveRequest(BaseModel):
    role: RoleEnum                      # confirm/override requested_role
    facility_ids: list[str] = []
    room_ids: list[str] = []
    assigned_tank_ids: list[str] = []

class RejectRequest(BaseModel):
    reason: str

class PendingUserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    requested_role: str
    created_at: str
