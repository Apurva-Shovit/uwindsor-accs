from fastapi import APIRouter, Depends
from ..models.species import Species
from ..schemas.species import SpeciesCreate
from ..core.permissions import get_current_user
from ..services.species_service import SpeciesService

router = APIRouter(prefix="/species", tags=["species"])

@router.get("/", response_model=list[Species])
async def list_species(current_user=Depends(get_current_user)):
    return await SpeciesService.list_species()

@router.post("/", response_model=Species)
async def create_species(species: SpeciesCreate, current_user=Depends(get_current_user)):
    return await SpeciesService.create_species(species, current_user)
