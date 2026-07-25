from pydantic import BaseModel
from typing import Optional

class RegisterFishRequest(BaseModel):
    fish_id: str
    rfid_tag: Optional[str] = None
    species: str
    tank_id: Optional[str] = None
    project_id: Optional[str] = None
    notes: Optional[str] = None
