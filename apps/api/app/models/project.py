from datetime import datetime, timezone
from typing import Literal, Optional
from beanie import Document
from pydantic import Field
from pymongo import IndexModel, ASCENDING


class Project(Document):
    """
    Research Project with associated AUPP.
    """
    title: str
    pi_name: str
    aupp_number: str
    status: Literal["active", "closed"] = "active"
    created_by: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    rfid_tracking_enabled: bool = False

    # Extended PRD metadata fields
    species: Optional[str] = None
    sex: Optional[Literal["male", "female", "both"]] = None
    dob: Optional[datetime] = None
    established_date: Optional[datetime] = None
    source: Optional[str] = None
    aupp_expiry_date: Optional[datetime] = None
    room_number: Optional[str] = None

    # Disposition fields
    closed_at: Optional[datetime] = None
    closed_by: Optional[str] = None
    disposition_type: Optional[Literal["euthanized", "transferred_external", "adopted", "other"]] = None
    disposition_notes: Optional[str] = None


    class Settings:
        name = "projects"
        indexes = [
            IndexModel([("aupp_number", ASCENDING)], unique=True)
        ]
