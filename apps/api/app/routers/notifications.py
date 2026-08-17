from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..core.permissions import (
    get_current_user,
    require_chair_or_admin,
    require_manager_plus,
)
from ..models.user import User
from ..services import push_service
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


class DeviceRegistration(BaseModel):
    """An FCM registration token as handed to the app by the Play Services SDK."""
    token: str = Field(min_length=1, max_length=4096)
    platform: str = Field(default="android", pattern="^(android|ios|web)$")


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


@router.post("/devices")
async def register_device(
    body: DeviceRegistration,
    current: User = Depends(get_current_user),
):
    """
    Bind this device's FCM token to the signed-in user.

    Any authenticated role may call it: everyone the feed addresses has alerts
    worth waking a phone for. The app re-posts on every launch because FCM can
    rotate a token at any time, so this is idempotent by design.
    """
    doc = await push_service.register_token(str(current.id), body.token, body.platform)
    return {
        "registered": True,
        "device_id": str(doc.id),
        # Lets the client tell "the server took my token" apart from "push will
        # never arrive because the server has no FCM credentials" — otherwise a
        # misconfigured deployment looks identical to a working one.
        "push_enabled": push_service.is_enabled(),
    }


@router.delete("/devices")
async def unregister_device(
    token: str = Query(..., min_length=1),
    current: User = Depends(get_current_user),
):
    """
    Drop a device registration, called on sign-out.

    Without this, a shared tablet keeps delivering the previous user's alerts
    until someone else signs in on it.
    """
    await push_service.prune_token(token)
    return {"unregistered": True}


@router.get("/push-status")
async def push_status(current: User = Depends(require_manager_plus)):
    """Whether the server can send push at all — for diagnosing a silent device."""
    return {"enabled": push_service.is_enabled(), "project_id": push_service.project_id()}


@router.post("/sweep")
async def sweep_notifications(current: User = Depends(require_manager_plus)):
    """
    Run the generator now instead of waiting for the next interval.

    The sweeper already covers normal operation; this is for the cases where
    waiting is not acceptable — verifying a config change, or picking up a newly
    approved user's tank assignments straight away.
    """
    return await NotificationService.sweep()
