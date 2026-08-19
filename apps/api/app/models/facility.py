from datetime import datetime
from beanie import Document
from pymongo import ASCENDING, IndexModel
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
            # Adding a tank is a find_one-then-insert, so only the database can
            # stop two concurrent adds (or the boot seeder running on two
            # replicas) from creating the same tank number twice in a room.
            # Soft-deleted tanks are excluded so a retired number can be reused.
            IndexModel(
                [("room_id", ASCENDING), ("tank_number", ASCENDING)],
                unique=True,
                name="unique_tank_number_per_room",
                partialFilterExpression={"deleted": False},
            ),
            IndexModel([("room_id", ASCENDING)]),
            IndexModel([("is_quarantined", ASCENDING)]),
        ]

