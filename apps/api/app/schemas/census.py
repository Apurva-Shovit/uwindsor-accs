from dateutil.parser import parse
from datetime import date
from typing import Literal, Optional
from pydantic import BaseModel, field_validator


class CensusEventCreate(BaseModel):
    tank_assignment_id: str
    event_type: Literal[
        "arrival",
        "death",
        "transfer_in",
        "transfer_out",
        "hatch",
        "manual_adjustment",
        "quarantine_placed",
        "quarantine_lifted"
    ]
    change: int
    reason: Optional[str] = None
    notes: Optional[str] = None
    date: Optional[date] = None
    # One per submission attempt, so a retry after a dropped response is
    # recognised instead of applied a second time.
    request_id: Optional[str] = None

    @field_validator("date", mode="before")
    @classmethod
    def parse_date(cls, v):
        if isinstance(v, str):
            try:
                return parse(v).date()
            except Exception:
                raise ValueError("Invalid date format")
        return v
