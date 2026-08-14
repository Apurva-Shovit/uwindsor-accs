from datetime import datetime, timezone as dt_timezone
from typing import Optional

from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, IndexModel


class DeviceToken(Document):
    """
    One FCM registration token, tied to the user who was signed in when it was
    issued.

    The token identifies a device install, not a person, so the same row is
    reassigned rather than duplicated when a second user signs in on a shared
    tablet — a shift handover must not leave the previous user's alerts arriving
    on a device they no longer hold. That is why `token` is unique on its own and
    `user_id` is a plain indexed field.

    Rows are never deleted on a send failure alone. FCM reports a permanently
    dead token distinctly from a transient one, and only the former clears the
    row (see push_service.prune_token); anything else is retried next sweep.
    """
    user_id: str
    token: str
    platform: str = "android"

    created_at: datetime = Field(default_factory=lambda: datetime.now(dt_timezone.utc))
    # Refreshed every time the app re-registers, which Capacitor does on each
    # launch. A token untouched for months is a stale install and safe to prune.
    last_seen_at: datetime = Field(default_factory=lambda: datetime.now(dt_timezone.utc))
    # Set when FCM rejects the token as permanently invalid. Kept rather than
    # deleted so a device that re-registers reuses the row and its history.
    disabled_at: Optional[datetime] = None
    last_error: Optional[str] = None

    class Settings:
        name = "device_tokens"
        indexes = [
            IndexModel([("token", ASCENDING)], unique=True),
            IndexModel([("user_id", ASCENDING), ("disabled_at", ASCENDING)]),
        ]
