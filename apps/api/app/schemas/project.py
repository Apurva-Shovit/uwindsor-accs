from datetime import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, Field, model_validator


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



class InternalTransferAllocation(BaseModel):
    """One slice of a project's fish population routed to another active AUPP on closure."""
    source_tank_assignment_id: str
    destination_project_id: str
    count: int = Field(gt=0, description="Number of fish in this slice")
    mode: Literal["relabel", "move"]
    # Required when mode == "move" (a different physical tank). Ignored for
    # "relabel", where the destination tank is implicitly the source tank --
    # the fish don't move, the tank's assignment just changes owner project.
    destination_tank_id: Optional[str] = None

    @model_validator(mode="after")
    def _check_destination_tank(self):
        if self.mode == "move" and not self.destination_tank_id:
            raise ValueError("destination_tank_id is required when mode is 'move'")
        return self


class ProjectClose(BaseModel):
    disposition_type: Literal["euthanized", "transferred_internal", "adopted", "other"]
    notes: Optional[str] = None
    # Required when disposition_type == "transferred_internal" and the project
    # has active tank assignments; describes how its population splits across
    # other AUPPs still open at the facility.
    internal_transfers: Optional[List[InternalTransferAllocation]] = None
