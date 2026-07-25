from fastapi import APIRouter, Depends, Query
from ..models.user import User
from ..core.permissions import require_chair_or_admin
from ..services.dashboard_service import DashboardService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("/summary")
async def get_dashboard_summary(current: User = Depends(require_chair_or_admin)):
    return await DashboardService.get_dashboard_summary()

@router.get("/activity")
async def get_dashboard_activity(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current: User = Depends(require_chair_or_admin),
):
    skip = (page - 1) * page_size
    return await DashboardService.get_dashboard_activity(skip, page_size)
