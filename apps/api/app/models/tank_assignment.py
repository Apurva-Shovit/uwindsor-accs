from datetime import datetime, timezone
from typing import Optional
from beanie import Document
from pydantic import Field


class TankAssignment(Document):
    """
    Live assignment of a project to a tank, tracking current count.
    """
    project_id: str
    tank_id: str
    current_count: int = 0
    pi_name: Optional[str] = None
    aupp_number: Optional[str] = None
    created_by: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "tank_assignments"
