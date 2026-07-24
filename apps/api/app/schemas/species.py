from pydantic import BaseModel, Field

class SpeciesCreate(BaseModel):
    name: str = Field(..., description="Name of the new species")
