from pydantic import BaseModel, Field
from typing import Optional


class TankTransferCreate(BaseModel):
    source_assignment_id: str
    destination_tank_id: str
    count: int = Field(gt=0, description="Number of fish to transfer")
    notes: Optional[str] = None
