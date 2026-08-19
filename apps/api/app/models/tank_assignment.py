from datetime import datetime, timezone
from typing import Optional
from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, IndexModel


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
        indexes = [
            # One row per project per tank. Without this, two concurrent first
            # intakes into a fresh tank both pass the find_one check and create
            # their own row -- from then on find_one picks one arbitrarily and
            # the rest of the population is invisible.
            IndexModel([("tank_id", ASCENDING), ("project_id", ASCENDING)], unique=True),
            # At most one *occupied* project per tank. This is the invariant the
            # "Destination tank is occupied by a different AUPP project" checks
            # were reaching for; expressed here it holds under concurrency,
            # where a read-then-insert never can. A credit that would break it
            # fails with DuplicateKeyError, which the services turn into a 409.
            IndexModel(
                [("tank_id", ASCENDING)],
                unique=True,
                name="one_occupied_project_per_tank",
                partialFilterExpression={"current_count": {"$gt": 0}},
            ),
            IndexModel([("project_id", ASCENDING)]),
        ]
