from datetime import date, datetime, timezone
from typing import Literal, Optional
from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, IndexModel


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
        "manual_adjustment",
        "quarantine_placed",
        "quarantine_lifted"
    ]
    change: int
    reason: Optional[str] = None
    notes: Optional[str] = None
    transfer_group_id: Optional[str] = None  # UUID string
    # Idempotency key supplied by the client, one per submission attempt. A
    # disabled button cannot help when the request left the tablet and the
    # response never came back: the user taps again and the same deaths are
    # recorded twice. Replaying the same key is refused by the unique index.
    request_id: Optional[str] = None
    created_by: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "census_events"
        indexes = [
            [("tank_id", 1), ("date", -1)],
            [("project_id", 1), ("date", -1)],
            [("event_type", 1), ("date", -1)],
            [("date", -1)],
            # Partial rather than sparse: every document carries request_id,
            # null included, and a sparse index would treat all those nulls as
            # colliding values. Restricting it to strings indexes only the
            # submissions that actually supplied a key.
            IndexModel(
                [("request_id", ASCENDING)],
                unique=True,
                name="unique_request_id",
                partialFilterExpression={"request_id": {"$type": "string"}},
            ),
        ]

