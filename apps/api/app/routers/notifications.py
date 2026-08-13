from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..core.permissions import (
    get_current_user,
    require_chair_or_admin,
    require_manager_plus,
)
from ..models.user import User
from ..services.notification_service import NotificationService

router = APIRouter(prefix="/notifications", tags=["notifications"])


class MarkReadRequest(BaseModel):
    keys: Optional[List[str]] = None
    all: bool = False


class DeadlineUpdate(BaseModel):
    """
    The daily water quality cutoff, as a wall-clock time in a named zone.

    A zone name rather than an offset: staff mean the same 3 PM either side of
    the daylight-saving change, which a stored offset would not give them.
    """
    hour: int = Field(ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    timezone: str = "America/Toronto"


@router.get("")
async def list_notifications(
    window: str = Query("all", pattern="^(all|recent)$"),
    current: User = Depends(get_current_user),
):
    """`recent` is the last 24 hours, which is what the bell shows; `all` is the panel."""
    return await NotificationService.list_notifications(current, window=window)


@router.post("/mark-read")
async def mark_notifications_read(
    body: MarkReadRequest,
    current: User = Depends(get_current_user),
):
    return await NotificationService.mark_read(current, keys=body.keys, mark_all=body.all)


@router.get("/settings")
async def get_notification_settings(current: User = Depends(require_manager_plus)):
    """
    Managers can read the deadline; only chairs and admins can move it.

    Staff do not need this endpoint — the cutoff they are held to is already on
    every feed response.
    """
    return await NotificationService.get_settings()


@router.put("/settings")
async def update_notification_settings(
    body: DeadlineUpdate,
    current: User = Depends(require_chair_or_admin),
):
    """Chair, admin and super admin only — this changes what everyone is held to."""
    return await NotificationService.update_settings(
        body.hour, body.minute, body.timezone, current
    )


@router.post("/sweep")
async def sweep_notifications(current: User = Depends(require_manager_plus)):
    """
    Run the generator now instead of waiting for the next interval.

    The sweeper already covers normal operation; this is for the cases where
    waiting is not acceptable — verifying a config change, or picking up a newly
    approved user's tank assignments straight away.
    """
    return await NotificationService.sweep()
