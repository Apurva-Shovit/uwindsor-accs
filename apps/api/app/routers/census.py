from typing import Optional
from fastapi import APIRouter, Depends
from ..models.user import User
from ..core.permissions import get_current_user
from ..schemas.census import CensusEventCreate
from ..services.census_service import CensusService

router = APIRouter(tags=["census"])

@router.post("/census-events", status_code=201)
async def create_census_event(
    body: CensusEventCreate,
    current: User = Depends(get_current_user),
):
    return await CensusService.create_census_event(body, current)

@router.get("/tank-assignments/{id}/history")
async def get_tank_assignment_history(
    id: str,
    current: User = Depends(get_current_user),
):
    return await CensusService.get_tank_assignment_history(id, current)

@router.get("/tank-assignments")
async def list_tank_assignments(
    tank_id: Optional[str] = None,
    current: User = Depends(get_current_user),
):
    return await CensusService.list_tank_assignments(tank_id, current)
