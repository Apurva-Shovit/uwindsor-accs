from datetime import datetime, timezone
from beanie import Document
from pydantic import BaseModel, Field
from typing import Any, Dict

class MutableBaseFields(BaseModel):
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str | None = None
    updated_by: str | None = None
    deleted: bool = False
    deleted_at: datetime | None = None
    deleted_by: str | None = None

    def dict_cleaned(self) -> Dict[str, Any]:
        """Returns a clean dict representation with formatted ISO dates and no internal DB leakage."""
        d = self.model_dump()
        d.pop("_id", None)
        d.pop("revision_id", None)
        d.pop("v", None)
        return d

