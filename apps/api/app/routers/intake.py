from fastapi import APIRouter, Depends
from ..models.user import User
from ..core.permissions import get_current_user
from ..services.intake_service import IntakeService, IntakeRequest

router = APIRouter(prefix="/intake", tags=["intake"])

@router.post("", status_code=201)
async def create_fish_intake(
    body: IntakeRequest,
    current: User = Depends(get_current_user),
):
    return await IntakeService.create_fish_intake(body, current)
