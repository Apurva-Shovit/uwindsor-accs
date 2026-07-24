from typing import Literal, Optional
from pydantic import BaseModel


class ProjectCreate(BaseModel):
    title: str
    pi_name: str
    aupp_number: str
    species: Optional[str] = None
    sex: Optional[Literal["male", "female", "both"]] = None
    dob: Optional[str] = None  # ISO date string
    established_date: Optional[str] = None  # ISO date string
    source: Optional[str] = None
    aupp_expiry_date: Optional[str] = None  # ISO date string
    room_number: Optional[str] = None
    rfid_tracking_enabled: bool = False



class ProjectClose(BaseModel):
    disposition_type: Literal["euthanized", "transferred_external", "adopted", "other"]
    notes: Optional[str] = None
