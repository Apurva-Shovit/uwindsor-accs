from typing import List
from fastapi import HTTPException
from ..models.user import User, RoleEnum
from ..models.species import Species
from ..schemas.species import SpeciesCreate

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}

class SpeciesService:
    """Service layer for Species."""

    @staticmethod
    async def list_species() -> List[Species]:
        return await Species.find_all().to_list()

    @staticmethod
    async def create_species(body: SpeciesCreate, current_user: User) -> Species:
        if current_user.role not in MANAGER_PLUS:
            raise HTTPException(status_code=403, detail="Insufficient permissions to add species")

        existing = await Species.find_one(Species.name == body.name)
        if existing:
            raise HTTPException(status_code=400, detail="Species already exists")

        new_species = Species(name=body.name, created_by=current_user.id)
        await new_species.insert()
        return new_species
