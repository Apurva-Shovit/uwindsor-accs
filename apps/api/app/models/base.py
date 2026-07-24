from datetime import datetime, timezone
from beanie import Document
from pydantic import BaseModel, Field

class MutableBaseFields(BaseModel):
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str | None = None
    updated_by: str | None = None
    deleted: bool = False
    deleted_at: datetime | None = None
    deleted_by: str | None = None
