from fastapi import APIRouter, Depends, Query
from datetime import datetime
from typing import Optional
from ..models.user import User
from ..core.permissions import require_manager_plus
from ..services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["reports"])

@router.get("/summary")
async def get_reports_summary(
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    facility_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    tank_id: Optional[str] = Query(None),
    current: User = Depends(require_manager_plus),
):
    return await ReportService.get_reports_summary(date_from, date_to, facility_id, project_id, tank_id, current)

@router.get("/executive-facility-summary")
async def get_executive_facility_summary(
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    granularity: str = Query("monthly"),
    current: User = Depends(require_manager_plus),
):
    return await ReportService.get_executive_facility_summary(date_from, date_to, granularity, current)
