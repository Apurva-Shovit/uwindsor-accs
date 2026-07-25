from pydantic import BaseModel
from typing import Optional
from datetime import date

class IncidentReportCreate(BaseModel):
    tank_id: str
    tank_assignment_id: Optional[str] = None
    date: date
    problem: str
    comments: Optional[str] = None
    treatment: Optional[str] = None
    aquatic_condition_checked: bool = False
    vet_contacted: bool = False
    researcher_notified: bool = False
