from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from ..models.user import User, RoleEnum, AuditLog
from ..models.facility import Facility, Room, Tank
from ..models.tank_assignment import TankAssignment
from ..models.project import Project
from ..models.water_quality_log import WaterQualityLog
from ..models.incident_report import IncidentReport
from ..models.census_event import CensusEvent
from ..core.permissions import get_current_user, require_chair_or_admin, require_manager_plus

router = APIRouter(prefix="/facilities-structure", tags=["facilities-structure"])


class FacilityCreate(BaseModel):
    name: str
    address: str | None = None
    description: str | None = None

class RoomCreate(BaseModel):
    facility_id: str
    room_number: str
    description: str | None = None

class TankCreate(BaseModel):
    room_id: str
    tank_number: str
    notes: str | None = None

class TankStatusUpdate(BaseModel):
    status: str

# Facilities
@router.get("/facilities")
async def list_facilities(current: User = Depends(get_current_user)):
    return await Facility.find({"deleted": False}).to_list()

@router.post("/facilities", status_code=201)
async def create_facility(body: FacilityCreate, current: User = Depends(require_chair_or_admin)):
    fac = Facility(name=body.name, address=body.address, description=body.description)
    await fac.insert()
    return fac

# Rooms
@router.get("/rooms")
async def list_rooms(facility_id: str | None = None, current: User = Depends(get_current_user)):
    query = {"deleted": False}
    if facility_id:
        query["facility_id"] = facility_id
    return await Room.find(query).to_list()

@router.post("/rooms", status_code=201)
async def create_room(body: RoomCreate, current: User = Depends(require_chair_or_admin)):
    r = Room(facility_id=body.facility_id, room_number=body.room_number, description=body.description)
    await r.insert()
    return r

# Tanks
@router.get("/tanks")
async def list_tanks(room_id: str | None = None, current: User = Depends(get_current_user)):
    query = {"deleted": False}
    if room_id:
        query["room_id"] = room_id
    tanks = await Tank.find(query).to_list()

    # Scope restriction for Staff
    if current.role == RoleEnum.staff:
        tanks = [t for t in tanks if str(t.id) in current.assigned_tank_ids]
    return tanks

@router.post("/tanks", status_code=201)
async def create_tank(body: TankCreate, current: User = Depends(require_chair_or_admin)):
    t = Tank(room_id=body.room_id, tank_number=body.tank_number, notes=body.notes)
    await t.insert()
    return t

@router.patch("/tanks/{id}")
async def patch_tank(id: str, body: TankStatusUpdate, current: User = Depends(require_chair_or_admin)):
    t = await Tank.get(id)
    if not t or t.deleted:
        raise HTTPException(404, "Tank not found")
    t.status = body.status
    await t.save()
    return t

@router.delete("/tanks/{id}")
async def delete_tank(id: str, current: User = Depends(require_chair_or_admin)):
    t = await Tank.get(id)
    if not t or t.deleted:
        raise HTTPException(404, "Tank not found")
    t.deleted = True
    await t.save()
    return {"message": "Tank deleted"}

class QuarantineToggle(BaseModel):
    is_quarantined: bool
    days: int = 14
    reason: str | None = None

@router.post("/tanks/{id}/quarantine")
async def toggle_tank_quarantine(
    id: str,
    body: QuarantineToggle,
    current: User = Depends(require_manager_plus),
):
    t = await Tank.get(id)
    if not t or t.deleted:
        raise HTTPException(404, "Tank not found")
        
    before = t.model_dump(mode="json")
    
    t.is_quarantined = body.is_quarantined
    if body.is_quarantined:
        t.quarantine_start_date = datetime.now(timezone.utc)
        from datetime import timedelta
        t.quarantine_end_date = t.quarantine_start_date + timedelta(days=body.days)
    else:
        t.quarantine_start_date = None
        t.quarantine_end_date = None
        
    await t.save()
    
    await AuditLog(
        actor_id=str(current.id),
        actor_role=current.role.value,
        action="quarantine_toggle",
        entity_type="tank",
        entity_id=str(t.id),
        before=before,
        after=t.model_dump(mode="json")
    ).insert()
    
    return {"message": "Quarantine status updated", "tank": t}

# SVG top-view summary
@router.get("/tanks/summary")
async def tanks_summary(current: User = Depends(get_current_user)):
    tanks = await Tank.find({"deleted": False}).to_list()
    
    # Restrict to assigned tanks if Staff
    if current.role == RoleEnum.staff:
        tanks = [t for t in tanks if str(t.id) in current.assigned_tank_ids]

    res = []
    for t in tanks:
        display_status = "healthy"
        if t.status == "inactive":
            display_status = "inactive"
        elif t.is_quarantined:
            display_status = "quarantine"

        # Load active assignment
        ta = await TankAssignment.find_one({
            "tank_id": str(t.id),
            "current_count": {"$gt": 0}
        })
        species = "N/A (No occupants)"
        aupp = "N/A"
        count = 0
        if ta:
            count = ta.current_count
            aupp = ta.aupp_number or "N/A"
            p = await Project.get(ta.project_id)
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

@router.get("/tanks/{id}/history")
async def get_tank_history(
    id: str,
    current: User = Depends(get_current_user),
):
    t = await Tank.get(id)
    if not t or t.deleted:
        raise HTTPException(404, "Tank not found")

    # Scope restriction for Staff
    if current.role == RoleEnum.staff:
        if id not in (current.assigned_tank_ids or []):
            raise HTTPException(403, "Not authorised to view this tank")

    history = []

    # 1. Census Events
    events = await CensusEvent.find({"tank_id": id}).to_list()
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
    wq = await WaterQualityLog.find({"tank_id": id}).to_list()
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
    incidents = await IncidentReport.find({"tank_id": id}).to_list()
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

    # Sort history: newest first
    history.sort(key=lambda x: x["created_at"], reverse=True)

    user_ids = {item["created_by"] for item in history if item.get("created_by")}
    from bson import ObjectId
    obj_ids = []
    for uid in user_ids:
        try:
            obj_ids.append(ObjectId(uid))
        except Exception:
            pass

    resolved_users = await User.find({"_id": {"$in": obj_ids}}).to_list()
    user_name_map = {str(u.id): f"{u.first_name} {u.last_name}" for u in resolved_users}

    for item in history:
        uid = item["created_by"]
        item["created_by"] = user_name_map.get(uid, uid or "System")

    return history



@router.get("/tanks/history/search")
async def search_tank_history(
    tank_id: str | None = Query(None),
    event_type: str | None = Query(None), # census, water_quality, incident
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    keyword: str | None = Query(None),
    current: User = Depends(get_current_user),
):
    tanks = await Tank.find({"deleted": False}).to_list()
    tank_map = {str(t.id): t.tank_number for t in tanks}

    # Staff scope check
    allowed_tank_ids = set(tank_map.keys())
    if current.role == RoleEnum.staff:
        allowed_tank_ids = set(current.assigned_tank_ids or [])

    if tank_id and tank_id not in allowed_tank_ids:
        raise HTTPException(403, "Not authorized to view history for this tank")

    target_tank_ids = [tank_id] if tank_id else list(allowed_tank_ids)

    combined = []

    # Dates parsing
    df = datetime.fromisoformat(date_from).date() if date_from else None
    dt = datetime.fromisoformat(date_to).date() if date_to else None

    # 1. Census Events
    if not event_type or event_type == "census":
        c_query = {"tank_id": {"$in": target_tank_ids}}
        census = await CensusEvent.find(c_query).to_list()
        for ev in census:
            if df and ev.date < df:
                continue
            if dt and ev.date > dt:
                continue
            t_num = tank_map.get(ev.tank_id, "Unknown")
            item = {
                "id": str(ev.id),
                "tank_id": ev.tank_id,
                "tank_number": t_num,
                "category": "Census",
                "event_type": ev.event_type,
                "details": f"Change: {ev.change:+d} | Reason: {ev.reason or 'N/A'}",
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
            if df and log.date < df:
                continue
            if dt and log.date > dt:
                continue
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
            if df and inc.date < df:
                continue
            if dt and inc.date > dt:
                continue
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

    # Resolve created_by user IDs to full names
    user_ids = {item["created_by"] for item in combined if item.get("created_by")}
    from bson import ObjectId
    obj_ids = []
    for uid in user_ids:
        try:
            obj_ids.append(ObjectId(uid))
        except Exception:
            pass

    resolved_users = await User.find({"_id": {"$in": obj_ids}}).to_list()
    user_name_map = {str(u.id): f"{u.first_name} {u.last_name}" for u in resolved_users}

    for item in combined:
        uid = item["created_by"]
        item["created_by"] = user_name_map.get(uid, uid or "System")

    return combined



