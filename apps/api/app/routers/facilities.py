from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from ..models.user import User
from ..core.permissions import get_current_user, require_chair_or_admin, require_manager_plus
from ..services.facility_service import FacilityService

router = APIRouter(prefix="/facilities-structure", tags=["facilities-structure"])

class FacilityCreate(BaseModel):
    name: str
    address: str | None = None
    description: str | None = None

class RoomCreate(BaseModel):
    facility_id: str
    room_number: str
    description: str | None = None

class TankCreate(BaseModel):
    room_id: str
    tank_number: str
    notes: str | None = None

class TankStatusUpdate(BaseModel):
    status: str

class QuarantineToggle(BaseModel):
    is_quarantined: bool
    days: int = 14
    reason: str | None = None

# Facilities
@router.get("/facilities")
async def list_facilities(current: User = Depends(get_current_user)):
    return await FacilityService.list_facilities()

@router.post("/facilities", status_code=201)
async def create_facility(body: FacilityCreate, current: User = Depends(require_chair_or_admin)):
    return await FacilityService.create_facility(body.name, body.address, body.description)

# Rooms
@router.get("/rooms")
async def list_rooms(facility_id: str | None = None, current: User = Depends(get_current_user)):
    return await FacilityService.list_rooms(facility_id)

@router.post("/rooms", status_code=201)
async def create_room(body: RoomCreate, current: User = Depends(require_chair_or_admin)):
    return await FacilityService.create_room(body.facility_id, body.room_number, body.description)

# Tanks
@router.get("/tanks")
async def list_tanks(room_id: str | None = None, current: User = Depends(get_current_user)):
    return await FacilityService.list_tanks(room_id, current)

@router.post("/tanks", status_code=201)
async def create_tank(body: TankCreate, current: User = Depends(require_chair_or_admin)):
    return await FacilityService.create_tank(body.room_id, body.tank_number, body.notes)

@router.patch("/tanks/{id}")
async def patch_tank(id: str, body: TankStatusUpdate, current: User = Depends(require_chair_or_admin)):
    return await FacilityService.patch_tank(id, body.status)

@router.delete("/tanks/{id}")
async def delete_tank(id: str, current: User = Depends(require_chair_or_admin)):
    await FacilityService.delete_tank(id)
    return {"message": "Tank deleted"}

@router.post("/tanks/{id}/quarantine")
async def toggle_tank_quarantine(id: str, body: QuarantineToggle, current: User = Depends(require_manager_plus)):
    tank = await FacilityService.toggle_tank_quarantine(id, body.is_quarantined, body.days, current)
    return {"message": "Quarantine status updated", "tank": tank}

@router.get("/tanks/summary")
async def tanks_summary(current: User = Depends(get_current_user)):
    return await FacilityService.get_tanks_summary(current)

@router.get("/tanks/{id}/history")
async def get_tank_history(id: str, current: User = Depends(get_current_user)):
    return await FacilityService.get_tank_history(id, current)

@router.get("/tanks/history/search")
async def search_tank_history(
    tank_id: str | None = Query(None),
    event_type: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    keyword: str | None = Query(None),
    current: User = Depends(get_current_user),
):
    return await FacilityService.search_tank_history(tank_id, event_type, date_from, date_to, keyword, current)
