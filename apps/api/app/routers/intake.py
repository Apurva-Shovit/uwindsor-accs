from fastapi import APIRouter, Depends, Request
from ..models.user import User
from ..core.permissions import get_current_user
from ..core.limiter import limiter
from ..config import settings
from ..services.intake_service import IntakeService, IntakeRequest

router = APIRouter(prefix="/intake", tags=["intake"])

@router.post("", status_code=201)
@limiter.limit(settings.RATE_LIMIT_DATA_ENTRY)
async def create_fish_intake(
    request: Request,
    body: IntakeRequest,
    current: User = Depends(get_current_user),
):
    return await IntakeService.create_fish_intake(body, current)
