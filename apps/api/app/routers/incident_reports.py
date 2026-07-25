from typing import Optional
from fastapi import APIRouter, Depends
from ..models.user import User
from ..core.permissions import get_current_user
from ..schemas.incident_report import IncidentReportCreate
from ..services.incident_report_service import IncidentReportService

router = APIRouter(prefix="/incident-reports", tags=["incident-reports"])

@router.post("", status_code=201)
async def create_incident_report(
    body: IncidentReportCreate,
    current: User = Depends(get_current_user),
):
    return await IncidentReportService.create_report(body, current)

@router.get("")
async def list_incident_reports(
    vet_contacted: Optional[bool] = None,
    tank_id: Optional[str] = None,
    current: User = Depends(get_current_user),
):
    return await IncidentReportService.list_reports(vet_contacted, tank_id, current)
