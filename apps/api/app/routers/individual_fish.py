from fastapi import APIRouter, Depends
from ..config import settings
from ..models.user import User
from ..core.permissions import get_current_user
from ..schemas.individual_fish import RegisterFishRequest
from ..services.individual_fish_service import IndividualFishService

router = APIRouter(prefix="/individual-fish", tags=["individual-fish"])

@router.get("/config")
async def get_rfid_config(current: User = Depends(get_current_user)):
    return {
        "rfid_tracking_enabled": settings.ENABLE_INDIVIDUAL_FISH_TRACKING
    }

@router.post("", status_code=201)
async def register_individual_fish(
    body: RegisterFishRequest,
    current: User = Depends(get_current_user),
):
    return await IndividualFishService.register_individual_fish(body, current)

@router.get("/scan/{tag}")
async def scan_rfid_tag(tag: str, current: User = Depends(get_current_user)):
    return await IndividualFishService.scan_rfid_tag(tag)
