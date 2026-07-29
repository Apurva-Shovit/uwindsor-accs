from fastapi import APIRouter, Depends, Request
from ..models.user import User
from ..core.permissions import get_current_user
from ..core.limiter import limiter
from ..config import settings
from ..schemas.transfer import TankTransferCreate
from ..services.transfer_service import TransferService

router = APIRouter(prefix="/tank-transfers", tags=["transfers"])

@router.post("", status_code=200)
@limiter.limit(settings.RATE_LIMIT_DATA_ENTRY)
async def create_tank_transfer(
    request: Request,
    body: TankTransferCreate,
    current: User = Depends(get_current_user),
):
    return await TransferService.create_tank_transfer(body, current)
