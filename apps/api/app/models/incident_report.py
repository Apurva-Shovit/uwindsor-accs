from datetime import date, datetime, timezone
from typing import Optional
from beanie import Document
from pydantic import Field


class IncidentReport(Document):
    """
    Immutable aquatic incident report.
    NEVER update, NEVER delete, NEVER soft-delete.
    """
    project_id: Optional[str] = None
    tank_assignment_id: Optional[str] = None
    tank_id: str
    date: date
    problem: str
    comments: Optional[str] = None
    treatment: Optional[str] = None
    aquatic_condition_checked: bool = False
    vet_contacted: bool = False
    researcher_notified: bool = False
    created_by: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "incident_reports"
        indexes = [
            [("tank_id", 1), ("date", -1)],
            [("project_id", 1), ("date", -1)],
            [("date", -1)],
        ]

