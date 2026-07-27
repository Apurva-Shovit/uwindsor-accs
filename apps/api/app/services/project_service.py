from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, status
from ..models.user import User, AuditLog, RoleEnum
from ..models.project import Project
from ..models.tank_assignment import TankAssignment
from ..models.census_event import CensusEvent
from ..models.incident_report import IncidentReport
from ..schemas.project import ProjectCreate, ProjectClose
from ..repositories.base_repository import BaseRepository
from ..repositories.audit_repository import AuditRepository

class ProjectService:
    """Service layer for Project Management."""

    @staticmethod
    async def create_project(body: ProjectCreate, current_user: User) -> Project:
        dob_dt = datetime.fromisoformat(body.dob) if body.dob else None
        est_dt = datetime.fromisoformat(body.established_date) if body.established_date else None
        exp_dt = datetime.fromisoformat(body.aupp_expiry_date) if body.aupp_expiry_date else None

        existing_project = await Project.find_one({"aupp_number": body.aupp_number})
        if existing_project:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"A project with AUPP number '{body.aupp_number}' already exists.")

        project = Project(
            title=body.title,
            pi_name=body.pi_name,
            aupp_number=body.aupp_number,
            species=body.species,
            sex=body.sex,
            dob=dob_dt,
            established_date=est_dt,
            source=body.source,
            aupp_expiry_date=exp_dt,
            room_number=body.room_number,
            rfid_tracking_enabled=body.rfid_tracking_enabled,
            created_by=str(current_user.id),
        )

        await project.insert()

        after = project.model_dump(mode="json")
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=str(current_user.role.value if current_user.role else "none"),
            action="create",
            entity_type="project",
            entity_id=str(project.id),
            before=None,
            after=after,
        ))
        
        return project

    @staticmethod
    async def get_project_details(project_id: str) -> Dict[str, Any]:
        p = await Project.get(project_id)
        if not p:
            raise HTTPException(404, "Project not found")

        assignments = await TankAssignment.find({"project_id": project_id, "current_count": {"$gt": 0}}).to_list()
        
        occupied_tanks = []
        total_fish_count = 0

        from ..models.facility import Tank
        for a in assignments:
            total_fish_count += a.current_count
            tank = await Tank.get(a.tank_id)
            occupied_tanks.append({
                "tank_assignment_id": str(a.id),
                "tank_id": a.tank_id,
                "tank_number": tank.tank_number if tank else "Unknown",
                "current_count": a.current_count,
                "is_quarantined": tank.is_quarantined if tank else False,
                "quarantine_start_date": tank.quarantine_start_date.isoformat() if (tank and tank.quarantine_start_date) else None,
                "quarantine_end_date": tank.quarantine_end_date.isoformat() if (tank and tank.quarantine_end_date) else None,
                "status": tank.status if tank else "active"
            })

        incidents = await IncidentReport.find({"project_id": project_id}).to_list()
        census_events = await CensusEvent.find({"project_id": project_id}).to_list()
        mortality = sum(abs(c.change) for c in census_events if c.event_type == "death")

        now = datetime.now(timezone.utc)
        is_expiring = False
        if p.aupp_expiry_date and p.status == "active":
            exp_date = p.aupp_expiry_date
            if exp_date.tzinfo is None:
                exp_date = exp_date.replace(tzinfo=timezone.utc)
            if exp_date <= now + timedelta(days=30):
                is_expiring = True

        res = p.model_dump(mode="json")
        res["id"] = str(p.id)
        res["total_fish_count"] = total_fish_count
        res["assigned_tanks_count"] = len(occupied_tanks)
        res["occupied_tanks"] = occupied_tanks
        res["total_incidents"] = len(incidents)
        res["total_mortality"] = mortality
        res["is_expiring"] = is_expiring
        return res

    @staticmethod
    async def get_project_report(
        project_id: str, 
        current_user: User,
        time_period: str = "all",
        page: int = 1,
        limit: int = 10
    ) -> Dict[str, Any]:
        p = await Project.get(project_id)
        if not p:
            raise HTTPException(404, "Project not found")

        from ..models.facility import Tank
        from ..models.water_quality_log import WaterQualityLog
        from ..utils.entity_resolver import EntityResolver
        from datetime import datetime, timezone, timedelta, date

        p_data = p.model_dump(mode="json")
        p_data["id"] = str(p.id)
        p_data["pi_name"] = getattr(p, "pi_name", None) or await EntityResolver.resolve_user_name(getattr(p, "pi_id", None)) or "N/A"

        # Calculate time period cutoff
        now = datetime.now(timezone.utc)
        cutoff = None
        if time_period == "7d":
            cutoff = now - timedelta(days=7)
        elif time_period == "30d":
            cutoff = now - timedelta(days=30)
        elif time_period == "90d":
            cutoff = now - timedelta(days=90)
        elif time_period == "1y":
            cutoff = now - timedelta(days=365)

        def get_dt(obj):
            dt = getattr(obj, "created_at", None)
            if not dt and hasattr(obj, "date"):
                d = getattr(obj, "date")
                if isinstance(d, datetime):
                    dt = d
                elif isinstance(d, date):
                    dt = datetime.combine(d, datetime.min.time()).replace(tzinfo=timezone.utc)
            if not dt:
                dt = getattr(obj, "timestamp", None)
            if dt and dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt

        # 1. Occupied Tanks
        assignments = await TankAssignment.find({"project_id": project_id, "current_count": {"$gt": 0}}).to_list()
        all_assignments_hist = await TankAssignment.find({"project_id": project_id}).to_list()
        assigned_tank_ids = list(set([a.tank_id for a in all_assignments_hist if a.tank_id]))

        occupied_tanks = []
        total_fish_count = 0

        for a in assignments:
            total_fish_count += a.current_count
            tank = await Tank.get(a.tank_id)
            occupied_tanks.append({
                "tank_assignment_id": str(a.id),
                "tank_id": a.tank_id,
                "tank_number": tank.tank_number if tank else "Unknown",
                "current_count": a.current_count,
                "is_quarantined": tank.is_quarantined if tank else False,
                "quarantine_start_date": tank.quarantine_start_date.isoformat() if (tank and tank.quarantine_start_date) else None,
                "quarantine_end_date": tank.quarantine_end_date.isoformat() if (tank and tank.quarantine_end_date) else None,
                "status": tank.status if tank else "active"
            })

        # 2. Census events (all & deaths)
        census_events = await CensusEvent.find({"project_id": project_id}).to_list()
        # Sort time-descending
        census_events.sort(key=lambda x: get_dt(x) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

        census_list = []
        deaths_list = []
        total_deaths = 0

        for c in census_events:
            c_dt = get_dt(c)
            if cutoff and c_dt and c_dt < cutoff:
                continue

            actor = await EntityResolver.resolve_user_name(c.created_by)
            tank_num = await EntityResolver.resolve_tank_number(c.tank_id)
            date_str = c_dt.strftime("%a, %b %d, %Y, %I:%M %p") if c_dt else str(c.date)
            
            c_dict = {
                "id": str(c.id),
                "event_type": c.event_type,
                "change": c.change,
                "tank_number": tank_num,
                "reason": c.reason or "-",
                "notes": c.notes or "-",
                "date": date_str,
                "actor_name": actor or "Unknown User",
                "created_at": c.created_at.isoformat() if getattr(c, "created_at", None) else None
            }
            census_list.append(c_dict)

            if c.event_type == "death":
                death_count = abs(c.change)
                total_deaths += death_count
                deaths_list.append({
                    "id": str(c.id),
                    "count": death_count,
                    "tank_number": tank_num,
                    "reason": c.reason or "Unspecified Mortality",
                    "notes": c.notes or "-",
                    "date": date_str,
                    "reported_by_name": actor or "Unknown User"
                })

        # 3. Incident reports
        try:
            incidents = await IncidentReport.find({"project_id": project_id}).to_list()
        except Exception:
            all_incidents = await IncidentReport.find_all().to_list()
            incidents = [i for i in all_incidents if getattr(i, "project_id", None) == project_id]

        incidents.sort(key=lambda x: get_dt(x) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

        incidents_list = []
        for inc in incidents:
            inc_dt = get_dt(inc)
            if cutoff and inc_dt and inc_dt < cutoff:
                continue

            creator_id = getattr(inc, "created_by", getattr(inc, "reported_by", None))
            reporter = await EntityResolver.resolve_user_name(creator_id)
            tank_num = await EntityResolver.resolve_tank_number(inc.tank_id)
            inc_date = inc_dt.strftime("%a, %b %d, %Y, %I:%M %p") if inc_dt else "-"

            problem = getattr(inc, "problem", getattr(inc, "description", "Aquatic Incident"))
            comments = getattr(inc, "comments", getattr(inc, "notes", "-"))
            treatment = getattr(inc, "treatment", None)
            if treatment:
                notes = f"Treatment: {treatment}. Notes: {comments}" if comments != "-" else f"Treatment: {treatment}"
            else:
                notes = comments

            incidents_list.append({
                "id": str(inc.id),
                "incident_type": problem,
                "severity": getattr(inc, "severity", "Standard"),
                "tank_number": tank_num,
                "description": problem,
                "vet_contacted": "Yes" if getattr(inc, "vet_contacted", False) else "No",
                "status": getattr(inc, "status", "Closed Log"),
                "notes": notes,
                "reported_by_name": reporter or "Unknown User",
                "date": inc_date
            })

        # 4. Water quality logs for assigned tanks
        wq_logs = []
        wq_records = []
        if assigned_tank_ids:
            try:
                wq_records = await WaterQualityLog.find({"$or": [{"project_id": project_id}, {"tank_id": {"$in": assigned_tank_ids}}]}).to_list()
            except Exception:
                all_wq = await WaterQualityLog.find_all().to_list()
                wq_records = [w for w in all_wq if getattr(w, "project_id", None) == project_id or getattr(w, "tank_id", None) in assigned_tank_ids]

        wq_records.sort(key=lambda x: get_dt(x) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

        for wq in wq_records:
            wq_dt = get_dt(wq)
            if cutoff and wq_dt and wq_dt < cutoff:
                continue

            creator_id = getattr(wq, "created_by", getattr(wq, "logged_by", None))
            logger = await EntityResolver.resolve_user_name(creator_id)
            tank_num = await EntityResolver.resolve_tank_number(wq.tank_id)
            wq_date = wq_dt.strftime("%a, %b %d, %Y, %I:%M %p") if wq_dt else "-"

            params = getattr(wq, "parameters", {})
            ph_val = params.get("pH", getattr(wq, "pH", "N/A"))
            temp_val = params.get("temperature_celsius", getattr(wq, "temperature_celsius", getattr(wq, "temperature", "N/A")))

            wq_logs.append({
                "id": str(wq.id),
                "tank_number": tank_num,
                "temperature_celsius": temp_val,
                "pH": ph_val,
                "logged_by_name": logger or "Unknown User",
                "date": wq_date,
                "notes": getattr(wq, "comments", getattr(wq, "notes", "-")) or "-"
            })

        # 5. Project audit logs
        try:
            audits = await AuditLog.find({"$or": [
                {"entity_type": "project", "entity_id": project_id},
                {"entity_type": "tank_assignment", "after.project_id": project_id},
                {"entity_type": "census_event", "after.project_id": project_id},
                {"entity_type": "incident_report", "after.project_id": project_id}
            ]}).to_list()
        except Exception:
            all_audits = await AuditLog.find_all().to_list()
            audits = [a for a in all_audits if (getattr(a, "entity_type", "") == "project" and getattr(a, "entity_id", "") == project_id) or (isinstance(getattr(a, "after", None), dict) and a.after.get("project_id") == project_id)]

        audits.sort(key=lambda x: get_dt(x) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

        audit_list = []
        for a in audits:
            aud_dt = get_dt(a)
            if cutoff and aud_dt and aud_dt < cutoff:
                continue

            actor = await EntityResolver.resolve_user_name(a.actor_id)
            ts_str = aud_dt.strftime("%a, %b %d, %Y, %I:%M %p") if aud_dt else "-"
            clean_before = await EntityResolver.resolve_payload_ids(a.before)
            clean_after = await EntityResolver.resolve_payload_ids(a.after)
            audit_list.append({
                "id": str(a.id),
                "actor_name": actor or "System User",
                "actor_role": a.actor_role or "Staff",
                "action": a.action,
                "entity_type": a.entity_type,
                "timestamp": ts_str,
                "before": clean_before,
                "after": clean_after
            })

        # Apply pagination helper
        def paginate(items):
            total_items = len(items)
            total_pages = max(1, (total_items + limit - 1) // limit)
            valid_page = max(1, min(page, total_pages))
            start_idx = (valid_page - 1) * limit
            end_idx = start_idx + limit
            return items[start_idx:end_idx], {
                "page": valid_page,
                "limit": limit,
                "total_items": total_items,
                "total_pages": total_pages
            }

        p_deaths, deaths_meta = paginate(deaths_list)
        p_incidents, incidents_meta = paginate(incidents_list)
        p_census, census_meta = paginate(census_list)
        p_wq, wq_meta = paginate(wq_logs)
        p_audits, audits_meta = paginate(audit_list)

        return {
            "project": p_data,
            "summary": {
                "total_fish_count": total_fish_count,
                "occupied_tanks_count": len(occupied_tanks),
                "total_deaths": total_deaths,
                "total_incidents": len(incidents_list),
                "total_census_events": len(census_list),
                "total_wq_logs": len(wq_logs),
                "total_audits": len(audit_list)
            },
            "time_period": time_period,
            "occupied_tanks": occupied_tanks,
            "deaths": p_deaths,
            "deaths_meta": deaths_meta,
            "incidents": p_incidents,
            "incidents_meta": incidents_meta,
            "census_events": p_census,
            "census_meta": census_meta,
            "water_quality_logs": p_wq,
            "water_quality_meta": wq_meta,
            "audit_logs": p_audits,
            "audit_meta": audits_meta
        }

    @staticmethod
    async def get_projects_overview(current_user: User) -> Dict[str, Any]:
        projects = await Project.find_all().to_list()
        assignments = await TankAssignment.find({"current_count": {"$gt": 0}}).to_list()
        incidents = await IncidentReport.find_all().to_list()
        census_events = await CensusEvent.find_all().to_list()

        from ..models.facility import Tank
        all_tanks = await Tank.find_all().to_list()
        tank_map = {str(t.id): t for t in all_tanks}

        now = datetime.now(timezone.utc)
        summaries = []
        expiring_count = 0

        for p in projects:
            p_id = str(p.id)
            p_assignments = [a for a in assignments if a.project_id == p_id]
            p_incidents = [inc for inc in incidents if inc.project_id == p_id]
            p_census = [c for c in census_events if c.project_id == p_id]

            current_fish = sum(a.current_count for a in p_assignments)
            mortality = sum(abs(c.change) for c in p_census if c.event_type == "death")

            occupied_tanks = []
            for a in p_assignments:
                t = tank_map.get(a.tank_id)
                occupied_tanks.append({
                    "tank_assignment_id": str(a.id),
                    "tank_id": a.tank_id,
                    "tank_number": t.tank_number if t else "Unknown",
                    "current_count": a.current_count,
                    "is_quarantined": t.is_quarantined if t else False,
                    "quarantine_start_date": t.quarantine_start_date.isoformat() if (t and t.quarantine_start_date) else None,
                    "quarantine_end_date": t.quarantine_end_date.isoformat() if (t and t.quarantine_end_date) else None,
                    "status": t.status if t else "active"
                })

            is_expiring = False
            if p.aupp_expiry_date and p.status == "active":
                exp_date = p.aupp_expiry_date
                if exp_date.tzinfo is None:
                    exp_date = exp_date.replace(tzinfo=timezone.utc)
                if exp_date <= now + timedelta(days=30):
                    is_expiring = True
                    expiring_count += 1

            summaries.append({
                "id": p_id,
                "title": p.title,
                "pi_name": p.pi_name,
                "aupp_number": p.aupp_number,
                "species": p.species or "Unspecified",
                "sex": p.sex or "both",
                "dob": p.dob.isoformat() if p.dob else None,
                "established_date": p.established_date.isoformat() if p.established_date else None,
                "source": p.source,
                "status": p.status,
                "aupp_expiry_date": p.aupp_expiry_date.isoformat() if p.aupp_expiry_date else None,
                "is_expiring": is_expiring,
                "assigned_tanks_count": len(occupied_tanks),
                "total_animals": current_fish,
                "total_fish_count": current_fish,
                "total_incidents": len(p_incidents),
                "total_mortality": mortality,
                "room_number": p.room_number or "-",
                "rfid_tracking_enabled": p.rfid_tracking_enabled,
                "occupied_tanks": occupied_tanks,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            })

        active_count = sum(1 for p in projects if p.status == "active")

        return {
            "total_projects": len(projects),
            "active_projects": active_count,
            "closed_projects": len(projects) - active_count,
            "expiring_soon": expiring_count,
            "projects": summaries
        }

    @staticmethod
    async def close_project(project_id: str, body: ProjectClose, current_user: User) -> Project:
        p = await Project.get(project_id)
        if not p:
            raise HTTPException(404, "Project not found")

        if p.status == "closed":
            raise HTTPException(409, "Project already closed")

        before = p.model_dump(mode="json")

        p.status = "closed"
        p.closed_at = datetime.now(timezone.utc)
        p.closed_by = str(current_user.id)
        p.disposition_type = body.disposition_type
        p.disposition_notes = body.notes
        await p.save()

        active_assignments = await TankAssignment.find({
            "project_id": str(p.id),
            "current_count": {"$gt": 0}
        }).to_list()

        if active_assignments:
            event_mapping = {
                "euthanized": "death",
                "transferred_external": "transfer_out",
                "adopted": "transfer_out",
                "other": "manual_adjustment"
            }
            census_type = event_mapping.get(body.disposition_type, "manual_adjustment")
            reason = f"Project Closed: {body.disposition_type.capitalize()}"

            for ta in active_assignments:
                ev = CensusEvent(
                    tank_id=ta.tank_id,
                    tank_assignment_id=str(ta.id),
                    project_id=str(p.id),
                    event_type=census_type,
                    change=-ta.current_count,
                    reason=reason,
                    notes=body.notes,
                    date=datetime.now(timezone.utc).date(),
                    created_by=str(current_user.id)
                )
                await ev.insert()
                
                ta.current_count = 0
                await ta.save()

        after = p.model_dump(mode="json")
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=str(current_user.role.value if current_user.role else "none"),
            action="close",
            entity_type="project",
            entity_id=str(p.id),
            before=before,
            after=after,
        ))
        
        return p
