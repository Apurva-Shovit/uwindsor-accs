from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, Optional

from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class Notification(Document):
    """
    One stored alert, already addressed to one recipient.

    Rows are per-user rather than per-event because the same underlying
    condition is a different notification depending on who reads it: a staff
    member is told about their own tanks and nothing else, while a manager sees
    every tank plus who it is assigned to. Writing the tailored copy at
    generation time keeps the read path a plain indexed query and means the
    scoping rule cannot be forgotten at any of the places that serve the feed.

    `key` is deterministic — derived from the condition and the day it applies
    to — so the sweeper can recognise an alert it has already written and update
    it in place instead of producing a duplicate every pass.
    """
    user_id: str
    key: str
    type: str
    severity: str
    title: str
    message: str
    link: str
    meta: Dict[str, Any] = Field(default_factory=dict)

    # When the condition became due (a 5 PM deadline, a quarantine entering its
    # final day). This drives ordering and the bell's 24-hour window, and is
    # deliberately not the row's insert time — a sweep that runs late, or
    # backfills after the service was spun down, must not look recent.
    created_at: datetime
    generated_at: datetime = Field(default_factory=lambda: datetime.now(dt_timezone.utc))

    read: bool = False
    read_at: Optional[datetime] = None

    class Settings:
        name = "notifications"
        indexes = [
            IndexModel([("user_id", ASCENDING), ("key", ASCENDING)], unique=True),
            IndexModel([("user_id", ASCENDING), ("read", ASCENDING)]),
            IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)]),
        ]


class NotificationSettings(Document):
    """
    The parts of the notification rules a chair or admin owns, kept as a single
    row so a redeploy cannot quietly reset a deadline someone deliberately moved.

    The deadline is stored as a wall-clock time plus a named zone rather than as
    a UTC hour: staff mean "3 PM" as they read it off the wall, and a stored UTC
    hour would silently drift by an hour every daylight-saving change.
    """
    singleton: str = "notification-settings"
    water_quality_deadline_hour: int = 15
    water_quality_deadline_minute: int = 0
    timezone: str = "America/Toronto"

    # `timezone` here is a field name, which is why datetime's is imported as
    # dt_timezone throughout this module.
    updated_at: datetime = Field(default_factory=lambda: datetime.now(dt_timezone.utc))
    updated_by: Optional[str] = None

    class Settings:
        name = "notification_settings"
        indexes = [
            IndexModel([("singleton", ASCENDING)], unique=True),
        ]


class NotificationSweepState(Document):
    """
    Bookkeeping for the generator, kept as a single row.

    Without it there is no way to tell "nothing needs attention" apart from "the
    sweeper has not run since the service woke up", which are very different
    things to show someone looking at an empty feed.
    """
    singleton: str = "notification-sweep"
    last_run_at: datetime = Field(default_factory=lambda: datetime.now(dt_timezone.utc))
    duration_ms: int = 0
    created: int = 0
    updated: int = 0
    removed: int = 0
    error: Optional[str] = None
    locked_at: Optional[datetime] = None
    locked_by: Optional[str] = None

    class Settings:
        name = "notification_sweep_state"
        indexes = [
            IndexModel([("singleton", ASCENDING)], unique=True),
        ]
