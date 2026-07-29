from beanie import Document
from .base import MutableBaseFields

class AuditLog(Document, MutableBaseFields):
    actor_id: str
    actor_role: str
    action: str            # e.g. "user_signup", "user_approve", "user_reject", "login"
    entity_type: str       # "user", "tank", "project", etc.
    entity_id: str
    before: dict | None = None
    after: dict | None = None

    class Settings:
        name = "audit_logs"
        indexes = [
            [("actor_id", 1), ("created_at", -1)],
            [("entity_type", 1), ("entity_id", 1)],
            [("action", 1), ("created_at", -1)],
            [("created_at", -1)],
        ]
