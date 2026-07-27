from typing import Dict, Any, List
from datetime import datetime
from ..repositories.audit_repository import AuditRepository
from ..utils.entity_resolver import EntityResolver

class AuditService:
    """Service layer for Audit Logs business logic."""

    @staticmethod
    async def get_paginated_logs(
        actor_id: str | None,
        entity_type: str | None,
        action: str | None,
        date_from: datetime | None,
        date_to: datetime | None,
        page: int,
        page_size: int
    ) -> List[Dict[str, Any]]:
        # 1. Build Query
        query: Dict[str, Any] = {}
        if actor_id: query["actor_id"] = actor_id
        if entity_type: query["entity_type"] = entity_type
        if action: query["action"] = action
        if date_from or date_to:
            date_filter: Dict[str, Any] = {}
            if date_from: date_filter["$gte"] = date_from
            if date_to: date_filter["$lte"] = date_to
            query["created_at"] = date_filter
            
        skip = (page - 1) * page_size

        # 2. Fetch logs from Repository
        logs = await AuditRepository.get_logs_with_pagination(query, skip, page_size)

        # 3. Extract all unique Actor IDs for bulk resolution
        actor_ids = list(set([str(log.actor_id) for log in logs if log.actor_id]))
        actor_map = await EntityResolver.resolve_users_by_ids(actor_ids)

        from bson import ObjectId

        def _extract_user_from_snapshot(payload: Dict[str, Any] | None) -> str | None:
            if not payload or not isinstance(payload, dict):
                return None
            fn = payload.get("first_name")
            ln = payload.get("last_name")
            if fn or ln:
                return f"{fn or ''} {ln or ''}".strip()
            email = payload.get("email")
            if email:
                return email
            return None

        # 4. Map the response
        result = []
        for log in logs:
            actor_name = actor_map.get(str(log.actor_id))
            if not actor_name or actor_name == "Unknown User" or (isinstance(actor_name, str) and ObjectId.is_valid(actor_name)):
                snapshot_name = _extract_user_from_snapshot(log.after) or _extract_user_from_snapshot(log.before)
                actor_name = snapshot_name or "Unknown User"

            display_id = str(log.entity_id) if log.entity_id else ""
            if log.entity_type != "user":
                display_id = await AuditRepository.get_entity_display_name(log.entity_type, str(log.entity_id))
            else:
                user_display = await EntityResolver.resolve_users_by_ids([str(log.entity_id)])
                resolved_id = user_display.get(str(log.entity_id))
                if not resolved_id or resolved_id == "Unknown User" or (isinstance(resolved_id, str) and ObjectId.is_valid(resolved_id)):
                    snapshot_name = _extract_user_from_snapshot(log.after) or _extract_user_from_snapshot(log.before)
                    display_id = snapshot_name or "Unknown User"
                else:
                    display_id = resolved_id

            if isinstance(display_id, str) and ObjectId.is_valid(display_id):
                display_id = f"Unknown {log.entity_type.replace('_', ' ').title()}"

            action_label = log.action
            if action_label == "quarantine_toggle" and log.after:
                action_label = "placed_in_quarantine" if log.after.get("is_quarantined") else "lifted_quarantine"

            # 5. Recursively resolve MongoDB ObjectIDs inside the payload diffs
            resolved_before = await EntityResolver.resolve_payload_ids(log.before) if log.before else None
            resolved_after = await EntityResolver.resolve_payload_ids(log.after) if log.after else None

            result.append({
                "actor_name": actor_name,
                "action": action_label,
                "entity_type": log.entity_type,
                "entity_id": display_id,
                "before": resolved_before,
                "after": resolved_after,
                "timestamp": log.created_at.isoformat(),
            })
            
        return result

    @staticmethod
    async def get_audit_logs(skip: int = 0, limit: int = 20) -> List[Dict[str, Any]]:
        page = (skip // limit) + 1 if limit > 0 else 1
        return await AuditService.get_paginated_logs(
            actor_id=None,
            entity_type=None,
            action=None,
            date_from=None,
            date_to=None,
            page=page,
            page_size=limit
        )

