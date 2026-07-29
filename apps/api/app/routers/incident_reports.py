from typing import Optional
from fastapi import APIRouter, Depends, Query, Request
from ..models.user import User
from ..core.permissions import get_current_user
from ..core.limiter import limiter
from ..config import settings
from ..schemas.incident_report import IncidentReportCreate
from ..services.incident_report_service import IncidentReportService

router = APIRouter(prefix="/incident-reports", tags=["incident-reports"])

@router.post("", status_code=201)
@limiter.limit(settings.RATE_LIMIT_DATA_ENTRY)
async def create_incident_report(
    request: Request,
    body: IncidentReportCreate,
    current: User = Depends(get_current_user),
):
    return await IncidentReportService.create_report(body, current)

@router.get("")
async def list_incident_reports(
    vet_contacted: Optional[bool] = None,
    tank_id: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current: User = Depends(get_current_user),
):
    return await IncidentReportService.list_reports(vet_contacted, tank_id, current, page=page, limit=limit)
