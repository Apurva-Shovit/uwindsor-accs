from datetime import datetime, timezone as dt_timezone
from typing import List, Optional
from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class EmailLog(Document):
    """
    Audit record of email notifications sent or attempted by the system.

    `key` is deterministic (e.g. `email:water_quality_missing:2026-09-08:user_<id>`
    or `email:water_quality_missing:2026-09-08:unassigned`), ensuring strict
    idempotency and preventing duplicate email sends for the same missing log event.
    """
    key: str
    type: str
    date: str
    recipient_user_id: Optional[str] = None
    recipient_email: str
    cc_emails: List[str] = Field(default_factory=list)
    tank_numbers: List[str] = Field(default_factory=list)
    sender_email: str
    subject: str
    status: str = "sent"  # "sent", "failed", "mock_sent"
    error: Optional[str] = None
    sent_at: datetime = Field(default_factory=lambda: datetime.now(dt_timezone.utc))

    class Settings:
        name = "email_logs"
        indexes = [
            IndexModel([("key", ASCENDING)], unique=True),
            IndexModel([("sent_at", DESCENDING)]),
            IndexModel([("type", ASCENDING), ("date", ASCENDING)]),
        ]
