from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel


class ProjectCreate(BaseModel):
    title: str
    pi_name: str
    aupp_number: str
    species: Optional[str] = None
    sex: Optional[Literal["male", "female", "both"]] = None
    # Typed as datetime so Pydantic does the parsing. It accepts the full ISO
    # 8601 range on every supported interpreter — including the trailing 'Z'
    # that Date.toISOString() emits and the date-only form the forms send — so
    # this no longer depends on the runtime's fromisoformat being new enough.
    # It also turns a malformed date into a 422 with a field-level message,
    # where hand-parsing in the service raised ValueError and returned a 500.
    # The Project document already stores these as datetime.
    dob: Optional[datetime] = None
    established_date: Optional[datetime] = None
    source: Optional[str] = None
    aupp_expiry_date: Optional[datetime] = None
    room_number: Optional[str] = None
    rfid_tracking_enabled: bool = False



class ProjectClose(BaseModel):
    disposition_type: Literal["euthanized", "transferred_external", "adopted", "other"]
    notes: Optional[str] = None
