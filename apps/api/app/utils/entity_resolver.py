"""
Entity Resolution Utility for ACARE Backend.
Resolves MongoDB relationship IDs (user_id, tank_id, room_id, project_id, etc.) into human-readable strings
(User Full Names, Tank Numbers, Room Numbers, Project Titles) before returning API responses.
"""
from typing import Dict, Any, List, Optional
from bson import ObjectId
from ..models.user import User
from ..models.facility import Tank, Room
from ..models.project import Project
from ..models.species import Species

class EntityResolver:
    @classmethod
    async def resolve_user_name(cls, user_id: Optional[str]) -> Optional[str]:
        if not user_id:
            return None
        try:
            user = await User.get(user_id)
            if user:
                return f"{user.first_name} {user.last_name}".strip()
            user_by_email = await User.find_one({"email": str(user_id)})
            if user_by_email:
                return f"{user_by_email.first_name} {user_by_email.last_name}".strip()
        except Exception:
            pass
        if isinstance(user_id, (str, ObjectId)) and ObjectId.is_valid(str(user_id)):
            return "Unknown User"
        return str(user_id)

    @classmethod
    async def resolve_users_by_ids(cls, user_ids: List[str]) -> Dict[str, str]:
        if not user_ids:
            return {}
        unique_ids = list(set([uid for uid in user_ids if uid]))
        valid_oids = [ObjectId(uid) for uid in unique_ids if ObjectId.is_valid(uid)]
        email_ids = [uid for uid in unique_ids if not ObjectId.is_valid(uid)]
        
        users_by_oid = await User.find({"_id": {"$in": valid_oids}}).to_list() if valid_oids else []
        users_by_email = await User.find({"email": {"$in": email_ids}}).to_list() if email_ids else []
        
        user_map: Dict[str, str] = {}
        for u in users_by_oid:
            user_map[str(u.id)] = f"{u.first_name} {u.last_name}".strip()
        for u in users_by_email:
            user_map[u.email] = f"{u.first_name} {u.last_name}".strip()
            
        res: Dict[str, str] = {}
        for uid in unique_ids:
            if uid in user_map:
                res[uid] = user_map[uid]
            elif ObjectId.is_valid(uid):
                res[uid] = "Unknown User"
            else:
                res[uid] = uid
        return res

    @classmethod
    async def resolve_tank_number(cls, tank_id: Optional[str]) -> Optional[str]:
        if not tank_id:
            return None
        try:
            tank = await Tank.get(tank_id)
            if tank:
                return f"Tank {tank.tank_number}"
        except Exception:
            pass
        if isinstance(tank_id, (str, ObjectId)) and ObjectId.is_valid(str(tank_id)):
            return "Unknown Tank"
        return str(tank_id)

    @classmethod
    async def resolve_room_number(cls, room_id: Optional[str]) -> Optional[str]:
        if not room_id:
            return None
        try:
            room = await Room.get(room_id)
            if room:
                return f"Room {room.room_number}"
        except Exception:
            pass
        if isinstance(room_id, (str, ObjectId)) and ObjectId.is_valid(str(room_id)):
            return "Unknown Room"
        return str(room_id)

    @classmethod
    async def resolve_project_title(cls, project_id: Optional[str]) -> Optional[str]:
        if not project_id:
            return None
        try:
            proj = await Project.get(project_id)
            if proj:
                return proj.title
        except Exception:
            pass
        if isinstance(project_id, (str, ObjectId)) and ObjectId.is_valid(str(project_id)):
            return "Unknown Project"
        return str(project_id)

    @classmethod
    async def resolve_payload_ids(cls, payload: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Recursively resolves known _id suffix fields in payloads to human-readable strings and strips raw ObjectIDs."""
        if not payload or not isinstance(payload, dict):
            return payload
        cleaned = {}
        for k, v in payload.items():
            # Strip database internal and security fields
            if k in ["_id", "id", "v", "revision_id", "password_hash", "password"]:
                continue
            if isinstance(v, ObjectId):
                v = str(v)
            if (k.endswith("_id") or k.endswith("_by")) and isinstance(v, str):
                if k in ["user_id", "created_by", "actor_id", "approved_by", "closed_by", "pi_id", "updated_by", "deleted_by"]:
                    cleaned[k.replace("_id", "_name").replace("_by", "_by_name")] = await cls.resolve_user_name(v)
                elif k == "tank_id":
                    cleaned["tank_number"] = await cls.resolve_tank_number(v)
                elif k == "room_id":
                    cleaned["room_number"] = await cls.resolve_room_number(v)
                elif k == "project_id":
                    cleaned["project_title"] = await cls.resolve_project_title(v)
                else:
                    resolved = await cls.resolve_user_name(v) if k.endswith("_by") else v
                    if isinstance(resolved, str) and ObjectId.is_valid(resolved):
                        resolved = "Unknown Reference"
                    cleaned[k] = resolved
            elif (k.endswith("_ids") or k in ["assigned_tank_ids", "facility_ids", "room_ids"]) and isinstance(v, list):
                resolved_list = []
                for item in v:
                    item_str = str(item)
                    if k == "assigned_tank_ids" or k.endswith("tank_ids"):
                        t_name = await cls.resolve_tank_number(item_str)
                        resolved_list.append(t_name)
                    elif k in ["facility_ids", "room_ids"]:
                        r_name = await cls.resolve_room_number(item_str) if "room" in k else item_str
                        resolved_list.append(r_name)
                    elif ObjectId.is_valid(item_str):
                        u_name = await cls.resolve_user_name(item_str)
                        resolved_list.append(u_name)
                    else:
                        resolved_list.append(item)
                cleaned[k.replace("_ids", "_list")] = resolved_list
            elif isinstance(v, dict):
                cleaned[k] = await cls.resolve_payload_ids(v)
            elif isinstance(v, list):
                cleaned_items = []
                for item in v:
                    if isinstance(item, dict):
                        cleaned_items.append(await cls.resolve_payload_ids(item))
                    elif isinstance(item, (str, ObjectId)) and ObjectId.is_valid(str(item)):
                        cleaned_items.append("Unknown Reference")
                    else:
                        cleaned_items.append(item)
                cleaned[k] = cleaned_items
            else:
                if isinstance(v, (str, ObjectId)) and ObjectId.is_valid(str(v)):
                    cleaned[k] = "Unknown Reference"
                else:
                    cleaned[k] = str(v) if isinstance(v, ObjectId) else v
        return cleaned


