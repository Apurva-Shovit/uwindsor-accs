from pydantic import BaseModel
from typing import Literal, Optional
from datetime import date

class WaterQualityCreate(BaseModel):
    tank_id: str
    type: Literal["daily", "test_strip"]
    date: date
    parameters: dict
    comments: Optional[str] = None

class WaterQualityBatchCreate(BaseModel):
    type: Literal["daily", "test_strip"]
    tank_ids: list[str]
    date: date
    parameters: dict
    comments: Optional[str] = None
