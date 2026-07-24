from fastapi import APIRouter, Depends, HTTPException
from beanie import PydanticObjectId
from ..models.species import Species
from ..schemas.species import SpeciesCreate
from ..core.permissions import get_current_user

router = APIRouter(prefix="/species", tags=["species"])

@router.get("/", response_model=list[Species])
async def list_species(current_user=Depends(get_current_user)):
    # Assuming all staff can view species list
    return await Species.find_all().to_list()

@router.post("/", response_model=Species)
async def create_species(species: SpeciesCreate, current_user=Depends(get_current_user)):
    # Optionally restrict to admin/manager roles
    if current_user.role not in ["admin", "manager", "super_admin", "chair"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions to add species")
    # Check uniqueness
    existing = await Species.find_one(Species.name == species.name)
    if existing:
        raise HTTPException(status_code=400, detail="Species already exists")
    new_species = Species(name=species.name, created_by=current_user.id)
    await new_species.insert()
    return new_species
