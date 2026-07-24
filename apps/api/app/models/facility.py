from datetime import datetime
from beanie import Document
from .base import MutableBaseFields

class Facility(Document, MutableBaseFields):
    name: str
    address: str | None = None
    description: str | None = None
    active: bool = True

    class Settings:
        name = "facilities"

class Room(Document, MutableBaseFields):
    facility_id: str
    room_number: str
    description: str | None = None
    active: bool = True

    class Settings:
        name = "rooms"

class Tank(Document, MutableBaseFields):
    room_id: str
    tank_number: str
    status: str = "active"  # "active" | "inactive"
    notes: str | None = None
    is_quarantined: bool = False
    quarantine_start_date: datetime | None = None
    quarantine_end_date: datetime | None = None

    class Settings:
        name = "tanks"
        indexes = [
            "room_id",
            "tank_number",
            "is_quarantined"
        ]

