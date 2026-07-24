from datetime import datetime, timezone
from typing import Optional, Literal
from beanie import Document
from pydantic import Field
from .base import MutableBaseFields

class QuarantineExemption(Document, MutableBaseFields):
    """
    Exemption request for moving fish out of a 14-day quarantine tank before window expires.
    """
    tank_id: str
    target_tank_id: str
    project_id: Optional[str] = None
    fish_count: int
    reason: str
    urgency: Literal["normal", "high", "critical"] = "normal"
    requested_by: str
    requested_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: Literal["pending", "approved", "rejected"] = "pending"
    decided_by: Optional[str] = None
    decided_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None

    class Settings:
        name = "quarantine_exemptions"
        indexes = [
            "tank_id",
            "status",
            "requested_by",
        ]
