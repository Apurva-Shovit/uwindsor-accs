from fastapi import APIRouter, Depends, Query
from typing import Optional
from ..models.user import User
from ..core.permissions import get_current_user, require_manager_plus
from ..services.quarantine_service import QuarantineService, ExemptionRequestCreate, ExemptionDecision

router = APIRouter(prefix="/quarantine", tags=["quarantine"])

@router.post("/exemption-request", status_code=201)
async def create_exemption_request(
    body: ExemptionRequestCreate,
    current: User = Depends(get_current_user),
):
    return await QuarantineService.create_exemption_request(body, current)

@router.get("/exemptions")
async def list_exemptions(
    status_filter: Optional[str] = Query(None),
    current: User = Depends(get_current_user),
):
    return await QuarantineService.list_exemptions(status_filter, current)

@router.patch("/exemption/{id}/decide")
async def decide_exemption(
    id: str,
    body: ExemptionDecision,
    current: User = Depends(require_manager_plus),
):
    return await QuarantineService.decide_exemption(id, body, current)
