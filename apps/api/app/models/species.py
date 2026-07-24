from beanie import Document, PydanticObjectId
from datetime import datetime
from typing import Optional
from pydantic import Field

class Species(Document):
    name: str = Field(..., description="Unique species name")
    created_by: Optional[PydanticObjectId] = Field(None, description="User who added the species")
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "species"
        indexes = ["name"]
