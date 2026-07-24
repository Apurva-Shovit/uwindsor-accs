from datetime import datetime, timezone
from typing import Optional, Literal
from beanie import Document
from pydantic import Field
from .base import MutableBaseFields

class IndividualFish(Document, MutableBaseFields):
    """
    Model for tracking individual fish via RFID / manual tag ID (Future feature toggle).
    """
    fish_id: str                          # Custom ID or RFID Tag String
    rfid_tag: Optional[str] = None
    species: str
    tank_id: Optional[str] = None
    project_id: Optional[str] = None
    dob: Optional[datetime] = None
    sex: Optional[Literal["male", "female", "both", "unknown"]] = "unknown"
    status: Literal["healthy", "quarantine", "sick", "deceased", "transferred"] = "healthy"
    notes: Optional[str] = None

    class Settings:
        name = "individual_fish"
        indexes = [
            "fish_id",
            "rfid_tag",
            "tank_id",
            "project_id",
            "status",
        ]
