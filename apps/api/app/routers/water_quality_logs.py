from typing import Optional
from fastapi import APIRouter, Depends
from ..models.user import User
from ..core.permissions import get_current_user
from ..schemas.water_quality import WaterQualityCreate, WaterQualityBatchCreate
from ..services.water_quality_service import WaterQualityService

router = APIRouter(prefix="/water-quality-logs", tags=["water-quality-logs"])

@router.post("", status_code=201)
async def create_water_quality_log(
    body: WaterQualityCreate,
    current: User = Depends(get_current_user),
):
    return await WaterQualityService.create_log(body, current)

@router.post("/batch", status_code=201)
async def create_batch_water_quality_logs(
    body: WaterQualityBatchCreate,
    current: User = Depends(get_current_user),
):
    return await WaterQualityService.create_batch_logs(body, current)

@router.get("")
async def list_water_quality_logs(
    tank_id: Optional[str] = None,
    current: User = Depends(get_current_user),
):
    return await WaterQualityService.list_logs(tank_id, current)
