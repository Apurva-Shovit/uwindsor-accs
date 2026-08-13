"""
The editable half of the notification rules.

The daily water quality deadline is not a deploy-time constant — chairs and
admins move it from the app — so it lives in the database and the values in
`config` only seed the row the first time the API meets an empty database.
Reading it goes through here so nothing is tempted to fall back to the seed
after someone has deliberately changed it.
"""
from dataclasses import dataclass
from datetime import date, datetime, tzinfo
from typing import Optional

from fastapi import HTTPException, status

from ..config import settings
from ..models.notification import NotificationSettings
from ..utils.clock import (
    deadline_at,
    format_deadline,
    is_valid_zone,
    resolve_zone,
)

SINGLETON = "notification-settings"


@dataclass(frozen=True)
class Deadline:
    """A wall-clock cutoff in a named zone, resolvable to an instant on any day."""
    hour: int
    minute: int
    timezone: str

    @property
    def zone(self) -> tzinfo:
        return resolve_zone(self.timezone)

    def on(self, day: date) -> datetime:
        """The instant this deadline passes on the given facility day, in UTC."""
        return deadline_at(day, self.hour, self.minute, self.zone)

    def label(self, moment: Optional[datetime] = None) -> str:
        """e.g. '3:00 PM EDT' — the abbreviation follows the date, not the season."""
        return format_deadline(self.hour, self.minute, self.zone, moment)

    def as_dict(self, moment: Optional[datetime] = None) -> dict:
        return {
            "hour": self.hour,
            "minute": self.minute,
            "timezone": self.timezone,
            "label": self.label(moment),
        }


class NotificationSettingsStore:
    @staticmethod
    async def get() -> NotificationSettings:
        """The stored settings, seeded from config on first use."""
        record = await NotificationSettings.find_one({"singleton": SINGLETON})
        if record is not None:
            return record

        record = NotificationSettings(
            singleton=SINGLETON,
            water_quality_deadline_hour=settings.WATER_QUALITY_DEADLINE_HOUR,
            water_quality_deadline_minute=settings.WATER_QUALITY_DEADLINE_MINUTE,
            timezone=settings.NOTIFICATION_TIMEZONE,
        )
        try:
            await record.insert()
        except Exception:
            # Two workers booting at once both seed; whichever lost the race
            # reads the row the other one wrote rather than failing the request.
            existing = await NotificationSettings.find_one({"singleton": SINGLETON})
            if existing is None:
                raise
            return existing
        return record

    @staticmethod
    async def deadline() -> Deadline:
        record = await NotificationSettingsStore.get()
        return Deadline(
            hour=record.water_quality_deadline_hour,
            minute=record.water_quality_deadline_minute,
            timezone=record.timezone,
        )

    @staticmethod
    def validate(hour: int, minute: int, timezone_name: str) -> None:
        if not 0 <= hour <= 23:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Hour must be between 0 and 23")
        if not 0 <= minute <= 59:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Minute must be between 0 and 59")
        if not is_valid_zone(timezone_name):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Unknown timezone '{timezone_name}'. Use an IANA name such as America/Toronto.",
            )
