from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException
from ..models.user import User, RoleEnum, AuditLog
from ..models.facility import Facility, Room, Tank
from ..models.tank_assignment import TankAssignment
from ..models.project import Project
from ..models.census_event import CensusEvent
from ..models.water_quality_log import WaterQualityLog
from ..models.incident_report import IncidentReport
from ..repositories.base_repository import BaseRepository
from ..repositories.audit_repository import AuditRepository
from ..utils.entity_resolver import EntityResolver

class FacilityService:
    """Service layer for Facility, Room, and Tank Management."""

    @staticmethod
    async def list_facilities() -> List[Facility]:
        return await Facility.find({"deleted": False}).to_list()

    @staticmethod
    async def create_facility(name: str, address: Optional[str], description: Optional[str]) -> Facility:
        fac = Facility(name=name, address=address, description=description)
        await fac.insert()
        return fac

    @staticmethod
    async def list_rooms(facility_id: Optional[str]) -> List[Room]:
        query = {"deleted": False}
        if facility_id:
            query["facility_id"] = facility_id
        return await Room.find(query).to_list()

    @staticmethod
    async def create_room(facility_id: str, room_number: str, description: Optional[str]) -> Room:
        r = Room(facility_id=facility_id, room_number=room_number, description=description)
        await r.insert()
        return r

    @staticmethod
    async def list_tanks(room_id: Optional[str], current_user: User) -> List[Tank]:
        query = {"deleted": False}
        if room_id:
            query["room_id"] = room_id
        tanks = await Tank.find(query).to_list()

        if current_user.role == RoleEnum.staff:
            tanks = [t for t in tanks if str(t.id) in current_user.assigned_tank_ids]
        return tanks

    @staticmethod
    async def create_tank(room_id: str, tank_number: str, notes: Optional[str]) -> Tank:
        existing = await Tank.find_one({"room_id": room_id, "tank_number": tank_number, "deleted": False})
        if existing:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Tank {tank_number} already exists in this room")
        t = Tank(room_id=room_id, tank_number=tank_number, notes=notes)
        await t.insert()
        return t

    @staticmethod
    async def patch_tank(tank_id: str, status: str) -> Tank:
        t = await Tank.get(tank_id)
        if not t or t.deleted:
            raise HTTPException(404, "Tank not found")
        t.status = status
        await t.save()
        return t

    @staticmethod
    async def delete_tank(tank_id: str) -> None:
        t = await Tank.get(tank_id)
        if not t or t.deleted:
            raise HTTPException(404, "Tank not found")
        t.deleted = True
        await t.save()

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
            
        before = t.model_dump(mode="json")
        
        t.is_quarantined = is_quarantined
        if is_quarantined:
            t.quarantine_start_date = datetime.now(timezone.utc)
            t.quarantine_end_date = t.quarantine_start_date + timedelta(days=days)
        else:
            t.quarantine_start_date = None
            t.quarantine_end_date = None
            
        await t.save()
        
        action_str = "placed_in_quarantine" if is_quarantined else "lifted_quarantine"
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=current_user.role.value if current_user.role else "none",
            action=action_str,
            entity_type="tank",
            entity_id=str(t.id),
            before=before,
            after=t.model_dump(mode="json")
        ))

        # Emit explicit quarantine CensusEvent for report timelines
        ta = await TankAssignment.find_one({"tank_id": tank_id, "current_count": {"$gt": 0}})
        if not ta:
            ta = await TankAssignment.find_one({"tank_id": tank_id})
        
        q_ev = CensusEvent(
            project_id=ta.project_id if ta else "",
            tank_assignment_id=str(ta.id) if ta else "",
            tank_id=tank_id,
            date=date.today(),
            event_type="quarantine_placed" if is_quarantined else "quarantine_lifted",
            change=0,
            reason="Mandatory 14-day Biosecurity Quarantine Initiated" if is_quarantined else "Quarantine Period Completed & Cleared",
            notes=f"Quarantine {'initiated' if is_quarantined else 'cleared'} by {current_user.first_name} {current_user.last_name}",
            created_by=str(current_user.id),
        )
        await q_ev.insert()
        
        return t

    @staticmethod
    async def get_tanks_summary(current_user: User) -> List[Dict[str, Any]]:
        tanks = await Tank.find({"deleted": False}).to_list()
        if current_user.role == RoleEnum.staff:
            tanks = [t for t in tanks if str(t.id) in current_user.assigned_tank_ids]

        tank_ids = [str(t.id) for t in tanks]
        
        # Bulk query for active assignments
        assignments = await TankAssignment.find({
            "tank_id": {"$in": tank_ids},
            "current_count": {"$gt": 0}
        }).to_list()
        
        assignment_map = {str(a.tank_id): a for a in assignments}
        
        # Bulk query for projects
        project_ids = [str(a.project_id) for a in assignments]
        projects = await Project.find({"_id": {"$in": [p for p in project_ids]}}).to_list() # Simplified for ObjectIds
        # Actually Project.find_many is safer but we'll use a direct fetch
        projects = await BaseRepository(Project).find({})
        project_map = {str(p.id): p for p in projects if str(p.id) in project_ids}

        res = []
        for t in tanks:
            display_status = "healthy"
            if t.status == "inactive":
                display_status = "inactive"
            elif t.is_quarantined:
                display_status = "quarantine"

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

            res.append({
                "id": str(t.id),
                "tank_number": t.tank_number,
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
    async def get_tank_history(tank_id: str, current_user: User) -> List[Dict[str, Any]]:
        t = await Tank.get(tank_id)
        if not t or t.deleted:
            raise HTTPException(404, "Tank not found")

        if current_user.role == RoleEnum.staff:
            if tank_id not in (current_user.assigned_tank_ids or []):
                raise HTTPException(403, "Not authorised to view this tank")

        history = []

        # 1. Census Events
        events = await CensusEvent.find({"tank_id": tank_id}).to_list()
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
                "created_at": ev.created_at.isoformat(),
            })

        # 2. Water Quality Logs
        wq = await WaterQualityLog.find({"tank_id": tank_id}).to_list()
        for log in wq:
            history.append({
                "type": "water_quality",
                "log_type": log.type,
                "parameters": log.parameters,
                "comments": log.comments,
                "date": str(log.date),
                "created_by": log.created_by,
                "created_at": log.created_at.isoformat(),
            })

        # 3. Incident Reports
        incidents = await IncidentReport.find({"tank_id": tank_id}).to_list()
        for inc in incidents:
            history.append({
                "type": "incident",
                "problem": inc.problem,
                "treatment": inc.treatment,
                "comments": inc.comments,
                "vet_contacted": inc.vet_contacted,
                "date": str(inc.date),
                "created_by": inc.created_by,
                "created_at": inc.created_at.isoformat(),
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
        date_from: Optional[str],
        date_to: Optional[str],
        keyword: Optional[str],
        current_user: User
    ) -> List[Dict[str, Any]]:
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

        # Dates parsing
        df = datetime.fromisoformat(date_from).date() if date_from else None
        dt = datetime.fromisoformat(date_to).date() if date_to else None

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
                item = {
                    "id": str(ev.id),
                    "tank_id": ev.tank_id,
                    "tank_number": t_num,
                    "category": category_name,
                    "event_type": ev.event_type,
                    "details": details_str,
                    "notes": ev.notes or "",
                    "date": str(ev.date),
                    "created_by": ev.created_by,
                    "created_at": ev.created_at.isoformat(),
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
                    "details": params_str,
                    "notes": log.comments or "",
                    "date": str(log.date),
                    "created_by": log.created_by,
                    "created_at": log.created_at.isoformat(),
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
                    "event_type": "Incident Flag",
                    "details": f"Problem: {inc.problem} | Vet Contacted: {inc.vet_contacted}",
                    "notes": inc.treatment or inc.comments or "",
                    "date": str(inc.date),
                    "created_by": inc.created_by,
                    "created_at": inc.created_at.isoformat(),
                }
                if keyword and keyword.lower() not in str(item).lower():
                    continue
                combined.append(item)

        combined.sort(key=lambda x: x["created_at"], reverse=True)

        user_ids = {item["created_by"] for item in combined if item.get("created_by")}
        user_map = await EntityResolver.resolve_users_by_ids(list(user_ids))

        for item in combined:
            uid = item["created_by"]
            item["created_by"] = user_map.get(uid, uid or "System")

        return combined
