from datetime import date, datetime, timezone
from typing import Literal, Optional
from beanie import Document
from pydantic import Field


class CensusEvent(Document):
    """
    Immutable census event tracking population changes.
    """
    project_id: str
    tank_assignment_id: str
    tank_id: str
    date: date
    event_type: Literal[
        "arrival",
        "death",
        "transfer_in",
        "transfer_out",
        "hatch",
        "manual_adjustment"
    ]
    change: int
    reason: Optional[str] = None
    notes: Optional[str] = None
    transfer_group_id: Optional[str] = None  # UUID string
    created_by: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "census_events"
        indexes = [
            [("tank_id", 1), ("date", -1)],
            [("project_id", 1), ("date", -1)],
            [("event_type", 1), ("date", -1)],
            [("date", -1)],
        ]

