from enum import Enum
from beanie import Document, Indexed
from pydantic import EmailStr
from .base import MutableBaseFields

class RoleEnum(str, Enum):
    super_admin = "super_admin"
    chair = "chair"
    admin = "admin"
    manager = "manager"
    staff = "staff"

class StatusEnum(str, Enum):
    pending = "pending"
    active = "active"
    suspended = "suspended"
    rejected = "rejected"

class User(Document, MutableBaseFields):
    email: Indexed(str, unique=True)
    password_hash: str
    first_name: str
    last_name: str
    requested_role: RoleEnum
    role: RoleEnum | None = None          # set only on approval
    status: StatusEnum = StatusEnum.pending
    facility_ids: list[str] = []
    room_ids: list[str] = []
    assigned_tank_ids: list[str] = []
    approved_by: str | None = None
    approved_at: str | None = None
    rejection_reason: str | None = None

    class Settings:
        name = "users"
        indexes = [
            "status",
            "role",
            [("status", 1), ("role", 1)],
        ]

