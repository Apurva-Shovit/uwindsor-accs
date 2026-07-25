from fastapi import APIRouter, Depends
from ..models.user import User
from ..core.permissions import get_current_user
from ..schemas.transfer import TankTransferCreate
from ..services.transfer_service import TransferService

router = APIRouter(prefix="/tank-transfers", tags=["transfers"])

@router.post("", status_code=200)
async def create_tank_transfer(
    body: TankTransferCreate,
    current: User = Depends(get_current_user),
):
    return await TransferService.create_tank_transfer(body, current)
