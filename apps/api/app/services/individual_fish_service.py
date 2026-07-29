from typing import Dict, Any, Optional
from fastapi import HTTPException
from ..models.user import User
from ..models.audit_log import AuditLog
from ..models.individual_fish import IndividualFish
from ..schemas.individual_fish import RegisterFishRequest
from ..repositories.audit_repository import AuditRepository

class IndividualFishService:
    """Service layer for Individual Fish (RFID)."""

    @staticmethod
    async def register_individual_fish(body: RegisterFishRequest, current_user: User) -> IndividualFish:
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

        after = fish.model_dump(mode="json")
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action="individual_fish_register",
            entity_type="individual_fish",
            entity_id=str(fish.id),
            before=None,
            after=after,
        ))

        return fish

    @staticmethod
    async def scan_rfid_tag(tag: str) -> IndividualFish:
        fish = await IndividualFish.find_one({"$or": [{"fish_id": tag}, {"rfid_tag": tag}]})
        if not fish:
            raise HTTPException(404, f"No individual fish record found for RFID tag: {tag}")
        return fish
