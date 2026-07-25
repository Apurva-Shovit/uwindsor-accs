from typing import List, Dict, Any, Set
from ..models.user import User
from ..models.facility import Tank
from ..models.project import Project
from bson import ObjectId

class EntityResolver:
    """
    Robust utility to resolve MongoDB ObjectIDs into human-readable strings
    for the frontend, preventing database schema leakage.
    """

    @staticmethod
    async def resolve_users_by_ids(user_ids: List[str]) -> Dict[str, str]:
        """Fetches only the requested users and returns a mapping of ID to Full Name."""
        if not user_ids:
            return {}
        
        # Filter out invalid ObjectIds to prevent Beanie crash
        valid_ids = [uid for uid in user_ids if ObjectId.is_valid(uid)]
        if not valid_ids:
            return {}

        users = await User.find({"_id": {"$in": [ObjectId(uid) for uid in valid_ids]}}).to_list()
        return {str(u.id): f"{u.first_name} {u.last_name}" for u in users}

    @staticmethod
    async def resolve_tanks_by_ids(tank_ids: List[str]) -> Dict[str, str]:
        """Fetches only the requested tanks and returns a mapping of ID to Tank Number."""
        if not tank_ids:
            return {}
            
        valid_ids = [tid for tid in tank_ids if ObjectId.is_valid(tid)]
        if not valid_ids:
            return {}

        tanks = await Tank.find({"_id": {"$in": [ObjectId(tid) for tid in valid_ids]}}).to_list()
        return {str(t.id): t.tank_number for t in tanks}

    @classmethod
    async def resolve_payload_ids(cls, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Recursively scans a payload dictionary for any fields ending in '_by' or '_id'.
        It collects all IDs, fetches them in bulk, and replaces the IDs with human readable names.
        """
        if not payload:
            return payload

        user_ids_to_fetch: Set[str] = set()
        tank_ids_to_fetch: Set[str] = set()

        # Step 1: Collect IDs
        for k, v in payload.items():
            if isinstance(v, str) and ObjectId.is_valid(v):
                if k.endswith('_by') or k in ['pi_id']:
                    user_ids_to_fetch.add(v)
                elif k == 'tank_id':
                    tank_ids_to_fetch.add(v)

        # Step 2: Fetch Mappings
        user_map = await cls.resolve_users_by_ids(list(user_ids_to_fetch))
        tank_map = await cls.resolve_tanks_by_ids(list(tank_ids_to_fetch))

        # Step 3: Replace
        resolved_payload = dict(payload)
        for k, v in resolved_payload.items():
            if isinstance(v, str):
                if k.endswith('_by') or k in ['pi_id']:
                    resolved_payload[k] = user_map.get(v, v)
                elif k == 'tank_id':
                    resolved_payload[k] = tank_map.get(v, v)

        return resolved_payload
