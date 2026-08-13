from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..core.permissions import get_current_user, require_manager_plus
from ..models.user import User
from ..services.notification_service import NotificationService

router = APIRouter(prefix="/notifications", tags=["notifications"])


class MarkReadRequest(BaseModel):
    keys: Optional[List[str]] = None
    all: bool = False


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


@router.post("/sweep")
async def sweep_notifications(current: User = Depends(require_manager_plus)):
    """
    Run the generator now instead of waiting for the next interval.

    The sweeper already covers normal operation; this is for the cases where
    waiting is not acceptable — verifying a config change, or picking up a newly
    approved user's tank assignments straight away.
    """
    return await NotificationService.sweep()
