from datetime import datetime, timezone
from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class NotificationRead(Document):
    """
    Read receipt for one derived notification.

    Notifications themselves are not stored — they are recomputed from tanks,
    logs, quarantines and projects on every request, so there is no job runner to
    keep alive and no risk of a stale row outliving the condition that produced
    it. The only thing that genuinely needs persisting is whether a given user
    has already seen a given alert, keyed by the notification's deterministic
    key.
    """
    user_id: str
    key: str
    read_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "notification_reads"
        indexes = [
            IndexModel([("user_id", ASCENDING), ("key", ASCENDING)], unique=True),
            IndexModel([("user_id", ASCENDING), ("read_at", DESCENDING)]),
        ]
