from typing import Optional
from fastapi import APIRouter, Depends, Query, Request
from ..models.user import User
from ..core.permissions import get_current_user
from ..core.limiter import limiter
from ..config import settings
from ..schemas.water_quality import WaterQualityCreate, WaterQualityBatchCreate
from ..services.water_quality_service import WaterQualityService

router = APIRouter(prefix="/water-quality-logs", tags=["water-quality-logs"])

@router.post("", status_code=201)
@limiter.limit(settings.RATE_LIMIT_DATA_ENTRY)
async def create_water_quality_log(
    request: Request,
    body: WaterQualityCreate,
    current: User = Depends(get_current_user),
):
    return await WaterQualityService.create_log(body, current)

@router.post("/batch", status_code=201)
@limiter.limit(settings.RATE_LIMIT_DATA_ENTRY)
async def create_batch_water_quality_logs(
    request: Request,
    body: WaterQualityBatchCreate,
    current: User = Depends(get_current_user),
):
    return await WaterQualityService.create_batch_logs(body, current)

@router.get("")
async def list_water_quality_logs(
    tank_id: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current: User = Depends(get_current_user),
):
    return await WaterQualityService.list_logs(tank_id, current, page=page, limit=limit)
