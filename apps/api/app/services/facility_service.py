from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, timedelta, date
from fastapi import HTTPException, status
from ..models.user import User, RoleEnum
from ..models.audit_log import AuditLog
from ..models.facility import Facility, Room, Tank
from ..models.tank_assignment import TankAssignment
from ..models.project import Project
from ..models.census_event import CensusEvent
from ..models.water_quality_log import WaterQualityLog
from ..models.incident_report import IncidentReport
from ..repositories.base_repository import BaseRepository
from ..repositories.audit_repository import AuditRepository
from ..utils.atomic import claim
from ..utils.entity_resolver import EntityResolver
from ..utils.quarantine_utils import lift_quarantine, lift_expired_quarantines

class FacilityService:
    """Service layer for Facility, Room, and Tank Management."""

    @staticmethod
    async def list_facilities() -> List[Facility]:
        return await Facility.find({"deleted": False}).to_list()

    @staticmethod
    async def create_facility(name: str, address: Optional[str], description: Optional[str], current_user: Optional[User] = None) -> Facility:
        fac = Facility(name=name, address=address, description=description)
        await fac.insert()
        if current_user:
            await AuditRepository.insert(AuditLog(
                actor_id=str(current_user.id),
                actor_role=str(current_user.role.value if current_user.role else "none"),
                action="create",
                entity_type="facility",
                entity_id=str(fac.id),
                before=None,
                after=fac.model_dump(mode="json"),
            ))
        return fac

    @staticmethod
    async def list_rooms(facility_id: Optional[str]) -> List[Room]:
        query = {"deleted": False}
        if facility_id:
            query["facility_id"] = facility_id
        return await Room.find(query).to_list()

    @staticmethod
    async def create_room(facility_id: str, room_number: str, description: Optional[str], current_user: Optional[User] = None) -> Room:
        r = Room(facility_id=facility_id, room_number=room_number, description=description)
        await r.insert()
        if current_user:
            await AuditRepository.insert(AuditLog(
                actor_id=str(current_user.id),
                actor_role=str(current_user.role.value if current_user.role else "none"),
                action="create",
                entity_type="room",
                entity_id=str(r.id),
                before=None,
                after=r.model_dump(mode="json"),
            ))
        return r

    @staticmethod
    async def list_tanks(room_id: Optional[str], current_user: User) -> List[Tank]:
        await lift_expired_quarantines()
        query = {"deleted": False}
        if room_id:
            query["room_id"] = room_id
        tanks = await Tank.find(query).to_list()

        if current_user.role == RoleEnum.staff:
            tanks = [t for t in tanks if str(t.id) in current_user.assigned_tank_ids]

        def tank_sort_key(t: Tank):
            try:
                return (0, int(t.tank_number))
            except (ValueError, TypeError):
                return (1, str(t.tank_number or ""))

        tanks.sort(key=tank_sort_key)
        return tanks

    @staticmethod
    async def create_tank(room_id: str, tank_number: str, notes: Optional[str], current_user: Optional[User] = None) -> Tank:
        existing = await Tank.find_one({"room_id": room_id, "tank_number": tank_number, "deleted": False})
        if existing:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Tank {tank_number} already exists in this room")
        t = Tank(room_id=room_id, tank_number=tank_number, notes=notes)
        await t.insert()
        if current_user:
            await AuditRepository.insert(AuditLog(
                actor_id=str(current_user.id),
                actor_role=str(current_user.role.value if current_user.role else "none"),
                action="create",
                entity_type="tank",
                entity_id=str(t.id),
                before=None,
                after=t.model_dump(mode="json"),
            ))
        return t

    @staticmethod
    async def patch_tank(tank_id: str, status: str, current_user: Optional[User] = None) -> Tank:
        t = await Tank.get(tank_id)
        if not t or t.deleted:
            raise HTTPException(404, "Tank not found")
        before = t.model_dump(mode="json")
        t.status = status
        await t.save()
        if current_user:
            await AuditRepository.insert(AuditLog(
                actor_id=str(current_user.id),
                actor_role=str(current_user.role.value if current_user.role else "none"),
                action="update",
                entity_type="tank",
                entity_id=str(t.id),
                before=before,
                after=t.model_dump(mode="json"),
            ))
        return t

    @staticmethod
    async def delete_tank(tank_id: str, current_user: Optional[User] = None) -> None:
        t = await Tank.get(tank_id)
        if not t or t.deleted:
            raise HTTPException(404, "Tank not found")
        before = t.model_dump(mode="json")
        t.deleted = True
        await t.save()
        if current_user:
            await AuditRepository.insert(AuditLog(
                actor_id=str(current_user.id),
                actor_role=str(current_user.role.value if current_user.role else "none"),
                action="delete",
                entity_type="tank",
                entity_id=str(t.id),
                before=before,
                after=t.model_dump(mode="json"),
            ))

    @staticmethod
    async def toggle_tank_quarantine(
        tank_id: str, 
        is_quarantined: bool, 
        days: int, 
        current_user: User
    ) -> Tank:
        t = await Tank.get(tank_id)
        if not t or t.deleted:
            raise HTTPException(404, "Tank not found")

        actor_role = current_user.role.value if current_user.role else "none"
        actor_name = f"{current_user.first_name} {current_user.last_name}".strip()

        if not is_quarantined:
            # Delegated so a manual release records how much of the window was
            # forfeited, in the same wording the expiry sweep uses.
            await lift_quarantine(
                t,
                actor_id=str(current_user.id),
                actor_role=actor_role,
                actor_name=actor_name,
            )
            return t

        before = t.model_dump(mode="json")

        start = datetime.now(timezone.utc)
        end = start + timedelta(days=days)

        # Placing a tank in quarantine is not idempotent -- it stamps a fresh
        # start date and emits a census event. A double-tapped button would
        # otherwise record the tank as quarantined twice and push the release
        # date out. Whoever loses the claim gets the tank as it stands.
        placed = await claim(
            Tank,
            t.id,
            {"is_quarantined": False},
            {
                "is_quarantined": True,
                "quarantine_start_date": start,
                "quarantine_end_date": end,
                "updated_at": start,
            },
        )
        if not placed:
            return await Tank.get(tank_id) or t

        t.is_quarantined = True
        t.quarantine_start_date = start
        t.quarantine_end_date = end
        t.updated_at = start

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=actor_role,
            action="placed_in_quarantine",
            entity_type="tank",
            entity_id=str(t.id),
            before=before,
            after=t.model_dump(mode="json")
        ))

        # Emit explicit quarantine CensusEvent for report timelines ONLY if tank has an active project assignment
        ta = await TankAssignment.find_one({"tank_id": tank_id, "current_count": {"$gt": 0}})
        if not ta:
            ta = await TankAssignment.find_one({"tank_id": tank_id})

        if ta and ta.project_id:
            q_ev = CensusEvent(
                project_id=ta.project_id,
                tank_assignment_id=str(ta.id),
                tank_id=tank_id,
                date=date.today(),
                event_type="quarantine_placed",
                change=0,
                reason="Manual Biosecurity Quarantine Initiated",
                notes=f"Quarantine manually initiated by {actor_name}",
                created_by=str(current_user.id),
            )
            await q_ev.insert()

        return t

    @staticmethod
    async def get_tanks_summary(current_user: User) -> List[Dict[str, Any]]:
        await lift_expired_quarantines()
        tanks = await Tank.find({"deleted": False}).to_list()
        if current_user.role == RoleEnum.staff:
            tanks = [t for t in tanks if str(t.id) in current_user.assigned_tank_ids]

        def tank_sort_key(t: Tank):
            try:
                return (0, int(t.tank_number))
            except (ValueError, TypeError):
                return (1, str(t.tank_number or ""))

        tanks.sort(key=tank_sort_key)

        tank_ids = [str(t.id) for t in tanks]
        
        # Bulk query for active assignments
        assignments = await TankAssignment.find({
            "tank_id": {"$in": tank_ids},
            "current_count": {"$gt": 0}
        }).to_list()
        
        assignment_map = {str(a.tank_id): a for a in assignments}
        
        # Bulk query for rooms and facilities
        from bson import ObjectId
        room_ids = [t.room_id for t in tanks if t.room_id]
        valid_room_oids = [ObjectId(rid) for rid in room_ids if ObjectId.is_valid(rid)]
        rooms = await Room.find({"_id": {"$in": valid_room_oids}}).to_list() if valid_room_oids else []
        
        fac_ids = [r.facility_id for r in rooms if r.facility_id]
        valid_fac_oids = [ObjectId(fid) for fid in fac_ids if ObjectId.is_valid(fid)]
        facilities = await Facility.find({"_id": {"$in": valid_fac_oids}}).to_list() if valid_fac_oids else []
        fac_map = {str(f.id): f.name for f in facilities}

        room_map = {}
        for r in rooms:
            room_map[str(r.id)] = {
                "room_number": r.room_number,
                "facility_name": fac_map.get(str(r.facility_id), "LaSalle Freshwater Restoration Ecology Centre")
            }

        # Bulk query for projects
        project_ids = [a.project_id for a in assignments if a.project_id]
        valid_oids = [ObjectId(pid) for pid in project_ids if ObjectId.is_valid(pid)]
        projects = await Project.find({"_id": {"$in": valid_oids}}).to_list() if valid_oids else []
        project_map = {str(p.id): p for p in projects}

        # Bulk query for 24h incidents and deaths (attention status)
        twenty_four_hours_ago_dt = datetime.now(timezone.utc) - timedelta(hours=24)
        twenty_four_hours_ago_date = twenty_four_hours_ago_dt.date()

        recent_24h_incidents = await IncidentReport.find({
            "$or": [
                {"created_at": {"$gte": twenty_four_hours_ago_dt}},
                {"date": {"$gte": twenty_four_hours_ago_date}}
            ]
        }).to_list()

        recent_24h_deaths = await CensusEvent.find({
            "event_type": "death",
            "$or": [
                {"created_at": {"$gte": twenty_four_hours_ago_dt}},
                {"date": {"$gte": twenty_four_hours_ago_date}}
            ]
        }).to_list()

        attention_tank_ids = set()
        for inc in recent_24h_incidents:
            if getattr(inc, "tank_id", None):
                attention_tank_ids.add(str(inc.tank_id))

        for death in recent_24h_deaths:
            if getattr(death, "tank_id", None):
                attention_tank_ids.add(str(death.tank_id))

        res = []
        for t in tanks:
            t_id_str = str(t.id)
            t_num_str = str(t.tank_number) if hasattr(t, "tank_number") and t.tank_number else t_id_str

            display_status = "healthy"
            if t.status == "inactive":
                display_status = "inactive"
            elif t.is_quarantined:
                display_status = "quarantine"
            elif t_id_str in attention_tank_ids or t_num_str in attention_tank_ids:
                display_status = "attention"

            ta = assignment_map.get(str(t.id))
            species = "N/A (No occupants)"
            aupp = "N/A"
            count = 0
            
            if ta:
                count = ta.current_count
                aupp = ta.aupp_number or "N/A"
                p = project_map.get(str(ta.project_id))
                if p:
                    species = p.species or "N/A"

            r_info = room_map.get(str(t.room_id), {})
            res.append({
                "id": str(t.id),
                "tank_number": t.tank_number,
                "room_id": t.room_id,
                "room_number": r_info.get("room_number", "1"),
                "facility_name": r_info.get("facility_name", "LaSalle Freshwater Restoration Ecology Centre"),
                "status": t.status,
                "display_status": display_status,
                "notes": t.notes,
                "species": species,
                "aupp": aupp,
                "count": count,
                "is_quarantined": t.is_quarantined,
                "quarantine_start_date": t.quarantine_start_date.isoformat() if t.quarantine_start_date else None,
                "quarantine_end_date": t.quarantine_end_date.isoformat() if t.quarantine_end_date else None
            })
        return res

    @staticmethod
    async def get_tank_history(tank_id: str, current_user: User, days: Optional[int] = None) -> List[Dict[str, Any]]:
        t = await Tank.get(tank_id)
        if not t or t.deleted:
            raise HTTPException(404, "Tank not found")

        if current_user.role == RoleEnum.staff:
            if tank_id not in (current_user.assigned_tank_ids or []):
                raise HTTPException(403, "Not authorised to view this tank")

        cutoff = None
        if days is not None and days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        history = []

        # 1. Census Events
        census_query: dict = {"tank_id": tank_id}
        if cutoff:
            census_query["date"] = {"$gte": cutoff}
        events = await CensusEvent.find(census_query).to_list()
        for ev in events:
            history.append({
                "type": "census",
                "event_type": ev.event_type,
                "change": ev.change,
                "reason": ev.reason,
                "notes": ev.notes,
                "transfer_group_id": ev.transfer_group_id,
                "date": str(ev.date),
                "created_by": ev.created_by,
                "created_at": ev.created_at.isoformat() if hasattr(ev.created_at, "isoformat") else str(ev.created_at),
            })

        # 2. Water Quality Logs
        wq_query: dict = {"tank_id": tank_id}
        if cutoff:
            wq_query["date"] = {"$gte": cutoff}
        wq = await WaterQualityLog.find(wq_query).to_list()
        for log in wq:
            history.append({
                "type": "water_quality",
                "log_type": log.type,
                "parameters": log.parameters,
                "comments": log.comments,
                "date": str(log.date),
                "created_by": log.created_by,
                "created_at": log.created_at.isoformat() if hasattr(log.created_at, "isoformat") else str(log.created_at),
            })

        # 3. Incident Reports
        inc_query: dict = {"tank_id": tank_id}
        if cutoff:
            inc_query["date"] = {"$gte": cutoff}
        incidents = await IncidentReport.find(inc_query).to_list()
        for inc in incidents:
            history.append({
                "type": "incident",
                "problem": inc.problem,
                "treatment": inc.treatment,
                "comments": inc.comments,
                "vet_contacted": inc.vet_contacted,
                "date": str(inc.date),
                "created_by": inc.created_by,
                "created_at": inc.created_at.isoformat() if hasattr(inc.created_at, "isoformat") else str(inc.created_at),
            })

        history.sort(key=lambda x: x["created_at"], reverse=True)


        # Bulk user resolution
        user_ids = {item["created_by"] for item in history if item.get("created_by")}
        user_map = await EntityResolver.resolve_users_by_ids(list(user_ids))

        for item in history:
            uid = item.get("created_by")
            if uid:
                item["created_by"] = user_map.get(uid, uid)

        return history

    @staticmethod
    async def search_tank_history(

        tank_id: Optional[str],
        event_type: Optional[str],
        date_from: Optional[datetime],
        date_to: Optional[datetime],
        keyword: Optional[str],
        current_user: User,
        page: int = 1,
        limit: int = 20
    ) -> Dict[str, Any]:
        tanks = await Tank.find({"deleted": False}).to_list()
        tank_map = {str(t.id): t.tank_number for t in tanks}

        # Staff scope check
        allowed_tank_ids = set(tank_map.keys())
        if current_user.role == RoleEnum.staff:
            allowed_tank_ids = set(current_user.assigned_tank_ids or [])

        if tank_id and tank_id not in allowed_tank_ids:
            raise HTTPException(403, "Not authorized to view history for this tank")

        target_tank_ids = [tank_id] if tank_id else list(allowed_tank_ids)

        combined = []

        # Already parsed by Pydantic at the route boundary; only the date part
        # is compared below.
        df = date_from.date() if date_from else None
        dt = date_to.date() if date_to else None

        # 1. Census & Quarantine Events
        if not event_type or event_type in ["census", "quarantine", "quarantine_placed", "quarantine_lifted"]:
            c_query = {"tank_id": {"$in": target_tank_ids}}
            census = await CensusEvent.find(c_query).to_list()
            for ev in census:
                is_quarantine_ev = ev.event_type in ["quarantine_placed", "quarantine_lifted"]
                if event_type == "census" and is_quarantine_ev:
                    continue
                if event_type == "quarantine" and not is_quarantine_ev:
                    continue
                if event_type in ["quarantine_placed", "quarantine_lifted"] and ev.event_type != event_type:
                    continue

                if df and ev.date < df: continue
                if dt and ev.date > dt: continue
                t_num = tank_map.get(ev.tank_id, "Unknown")
                category_name = "Quarantine" if is_quarantine_ev else "Census"
                details_str = f"Status: {ev.reason or 'Quarantine Action'}" if is_quarantine_ev else f"Change: {ev.change:+d} | Reason: {ev.reason or 'N/A'}"
                display_ev = "Quarantine Placed" if ev.event_type == "quarantine_placed" else "Quarantine Lifted" if ev.event_type == "quarantine_lifted" else str(ev.event_type).replace('_', ' ').title()
                item = {
                    "id": str(ev.id),
                    "tank_id": ev.tank_id,
                    "tank_number": t_num,
                    "category": category_name,
                    "event_type": ev.event_type,
                    "display_event_type": display_ev,
                    "details": details_str,
                    "notes": ev.notes or "",
                    "date": str(ev.date),
                    "created_by": ev.created_by,
                    "created_at": ev.created_at.isoformat() if hasattr(ev.created_at, "isoformat") else str(ev.created_at),
                }
                if keyword and keyword.lower() not in str(item).lower():
                    continue
                combined.append(item)

        # 2. Water Quality Logs
        if not event_type or event_type == "water_quality":
            wq_query = {"tank_id": {"$in": target_tank_ids}}
            wq_logs = await WaterQualityLog.find(wq_query).to_list()
            for log in wq_logs:
                if df and log.date < df: continue
                if dt and log.date > dt: continue
                t_num = tank_map.get(log.tank_id, "Unknown")
                params_str = ", ".join([f"{k}: {v}" for k, v in log.parameters.items()])
                item = {
                    "id": str(log.id),
                    "tank_id": log.tank_id,
                    "tank_number": t_num,
                    "category": "Water Quality",
                    "event_type": log.type,
                    "display_event_type": str(log.type).replace('_', ' ').title(),
                    "details": params_str,
                    "notes": log.comments or "",
                    "date": str(log.date),
                    "created_by": log.created_by,
                    "created_at": log.created_at.isoformat() if hasattr(log.created_at, "isoformat") else str(log.created_at),
                }
                if keyword and keyword.lower() not in str(item).lower():
                    continue
                combined.append(item)

        # 3. Incident Reports
        if not event_type or event_type == "incident":
            inc_query = {"tank_id": {"$in": target_tank_ids}}
            incidents = await IncidentReport.find(inc_query).to_list()
            for inc in incidents:
                if df and inc.date < df: continue
                if dt and inc.date > dt: continue
                t_num = tank_map.get(inc.tank_id, "Unknown")
                item = {
                    "id": str(inc.id),
                    "tank_id": inc.tank_id,
                    "tank_number": t_num,
                    "category": "Incident",
                    "event_type": "incident",
                    "display_event_type": "Incident Flag",
                    "details": f"Problem: {inc.problem} | Vet Contacted: {'Yes' if inc.vet_contacted else 'No'}",
                    "notes": inc.treatment or inc.comments or "",
                    "date": str(inc.date),
                    "created_by": inc.created_by,
                    "created_at": inc.created_at.isoformat() if hasattr(inc.created_at, "isoformat") else str(inc.created_at),
                }

                if keyword and keyword.lower() not in str(item).lower():
                    continue
                combined.append(item)

        combined.sort(key=lambda x: x["created_at"], reverse=True)

        total_items = len(combined)
        total_pages = (total_items + limit - 1) // limit if limit > 0 else 1
        skip = (page - 1) * limit
        paginated_items = combined[skip:skip + limit]

        user_ids = {item["created_by"] for item in paginated_items if item.get("created_by")}
        user_map = await EntityResolver.resolve_users_by_ids(list(user_ids))

        for item in paginated_items:
            uid = item["created_by"]
            item["created_by"] = user_map.get(uid, uid or "System")

        return {
            "items": paginated_items,
            "total": total_items,
            "page": page,
            "limit": limit,
            "total_pages": total_pages
        }

