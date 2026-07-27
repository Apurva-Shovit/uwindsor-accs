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
    async def get_project_report(project_id: str, current_user: User) -> Dict[str, Any]:
        p = await Project.get(project_id)
        if not p:
            raise HTTPException(404, "Project not found")

        from ..models.facility import Tank
        from ..models.water_quality_log import WaterQualityLog
        from ..utils.entity_resolver import EntityResolver

        p_data = p.model_dump(mode="json")
        p_data["id"] = str(p.id)

        # 1. Occupied tanks & historic assignments
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
        census_events = await CensusEvent.find({"project_id": project_id}).sort("-date").to_list()
        census_list = []
        deaths_list = []
        total_deaths = 0

        for c in census_events:
            actor = await EntityResolver.resolve_user_name(c.created_by)
            tank_num = await EntityResolver.resolve_tank_number(c.tank_id)
            date_str = c.date.strftime("%a, %b %d, %Y") if hasattr(c.date, "strftime") else str(c.date)
            
            c_dict = {
                "id": str(c.id),
                "event_type": c.event_type,
                "change": c.change,
                "tank_number": tank_num,
                "reason": c.reason or "-",
                "notes": c.notes or "-",
                "date": date_str,
                "actor_name": actor or "Unknown User",
                "created_at": c.created_at.isoformat() if c.created_at else None
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

        incidents_list = []
        for inc in incidents:
            creator_id = getattr(inc, "created_by", getattr(inc, "reported_by", None))
            reporter = await EntityResolver.resolve_user_name(creator_id)
            tank_num = await EntityResolver.resolve_tank_number(inc.tank_id)
            
            created_dt = getattr(inc, "created_at", None)
            if created_dt:
                inc_date = created_dt.strftime("%a, %b %d, %Y, %I:%M %p")
            elif hasattr(inc, "date") and inc.date:
                inc_date = inc.date.strftime("%a, %b %d, %Y")
            else:
                inc_date = "-"

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

        for wq in wq_records:
            creator_id = getattr(wq, "created_by", getattr(wq, "logged_by", None))
            logger = await EntityResolver.resolve_user_name(creator_id)
            tank_num = await EntityResolver.resolve_tank_number(wq.tank_id)
            
            created_dt = getattr(wq, "created_at", None)
            if created_dt:
                wq_date = created_dt.strftime("%a, %b %d, %Y, %I:%M %p")
            elif hasattr(wq, "date") and wq.date:
                wq_date = wq.date.strftime("%a, %b %d, %Y")
            else:
                wq_date = "-"

            params = getattr(wq, "parameters", {})
            ph_val = params.get("pH", getattr(wq, "pH", "N/A"))
            temp_val = params.get("temperature_celsius", getattr(wq, "temperature_celsius", "N/A"))
            sal_val = params.get("salinity_ppt", getattr(wq, "salinity_ppt", "N/A"))
            do_val = params.get("dissolved_oxygen_mg_l", getattr(wq, "dissolved_oxygen_mg_l", "N/A"))
            amm_val = params.get("ammonia_ppm", getattr(wq, "ammonia_ppm", "N/A"))
            nit_val = params.get("nitrate_ppm", getattr(wq, "nitrate_ppm", "N/A"))

            wq_logs.append({
                "id": str(wq.id),
                "tank_number": tank_num,
                "temperature_celsius": temp_val,
                "pH": ph_val,
                "salinity_ppt": sal_val,
                "dissolved_oxygen_mg_l": do_val,
                "ammonia_ppm": amm_val,
                "nitrate_ppm": nit_val,
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
            ]}).sort("-created_at").to_list()
        except Exception:
            all_audits = await AuditLog.find_all().to_list()
            audits = [a for a in all_audits if (getattr(a, "entity_type", "") == "project" and getattr(a, "entity_id", "") == project_id) or (isinstance(getattr(a, "after", None), dict) and a.after.get("project_id") == project_id)]

        audit_list = []
        for a in audits:
            actor = await EntityResolver.resolve_user_name(a.actor_id)
            aud_dt = getattr(a, "created_at", getattr(a, "timestamp", None))
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
            "occupied_tanks": occupied_tanks,
            "deaths": deaths_list,
            "incidents": incidents_list,
            "census_events": census_list,
            "water_quality_logs": wq_logs,
            "audit_logs": audit_list
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
