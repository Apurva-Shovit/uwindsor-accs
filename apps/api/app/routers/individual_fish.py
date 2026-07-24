from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from typing import Optional

from ..config import settings
from ..models.user import User, AuditLog
from ..models.individual_fish import IndividualFish
from ..core.permissions import get_current_user

router = APIRouter(prefix="/individual-fish", tags=["individual-fish"])

class RegisterFishRequest(BaseModel):
    fish_id: str
    rfid_tag: Optional[str] = None
    species: str
    tank_id: Optional[str] = None
    project_id: Optional[str] = None
    notes: Optional[str] = None

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
    existing = await IndividualFish.find_one({"fish_id": body.fish_id})
    if existing:
        raise HTTPException(400, "Fish ID already registered")

    fish = IndividualFish(
        fish_id=body.fish_id,
        rfid_tag=body.rfid_tag,
        species=body.species,
        tank_id=body.tank_id,
        project_id=body.project_id,
        notes=body.notes,
    )
    await fish.insert()

    await AuditLog(
        actor_id=str(current.id),
        actor_role=current.role.value,
        action="individual_fish_register",
        entity_type="individual_fish",
        entity_id=str(fish.id),
        after=fish.model_dump(mode="json")
    ).insert()

    return fish

@router.get("/scan/{tag}")
async def scan_rfid_tag(tag: str, current: User = Depends(get_current_user)):
    fish = await IndividualFish.find_one({"$or": [{"fish_id": tag}, {"rfid_tag": tag}]})
    if not fish:
        raise HTTPException(404, f"No individual fish record found for RFID tag: {tag}")
    return fish
