from typing import List, Dict, Any, Optional
from datetime import datetime, date, timezone
from fastapi import HTTPException
from ..models.user import User, RoleEnum
from ..models.water_quality_log import WaterQualityLog
from ..models.incident_report import IncidentReport
from ..models.census_event import CensusEvent
from ..models.project import Project
from ..models.facility import Facility, Room, Tank
from ..utils.entity_resolver import EntityResolver
from ..repositories.base_repository import BaseRepository

class ReportService:
    """Service layer for Aggregated Reporting."""

    @staticmethod
    async def get_reports_summary(
        date_from: Optional[datetime],
        date_to: Optional[datetime],
        facility_id: Optional[str],
        project_id: Optional[str],
        tank_id: Optional[str],
        current_user: User
    ) -> List[Dict[str, Any]]:
        tanks_list = await Tank.find_all().to_list()
        rooms_list = await Room.find_all().to_list()
        facs_list = await Facility.find_all().to_list()
        projects_list = await Project.find_all().to_list()

        tank_map = {str(t.id): t for t in tanks_list}
        room_map = {str(r.id): r for r in rooms_list}
        fac_map = {str(f.id): f for f in facs_list}
        proj_map = {str(p.id): p for p in projects_list}

        def resolve_location(t_id: str):
            t = tank_map.get(t_id)
            if not t:
                return "Unknown Facility", "Unknown Room", "Unknown Tank", None
            r = room_map.get(t.room_id)
            if not r:
                return "Unknown Facility", "Unknown Room", f"Tank {t.tank_number}", None
            f = fac_map.get(r.facility_id)
            fac_name = f.name if f else "Unknown Facility"
            return fac_name, f"Room {r.room_number}", f"Tank {t.tank_number}", r.facility_id

        def date_filter(doc):
            val = doc.get("date")
            if not val:
                return True
            val_date = val.date() if isinstance(val, datetime) else val
            if date_from:
                df_date = date_from.date() if isinstance(date_from, datetime) else date_from
                if val_date < df_date:
                    return False
            if date_to:
                dt_date = date_to.date() if isinstance(date_to, datetime) else date_to
                if val_date > dt_date:
                    return False
            return True

        results: List[dict] = []

        # Water Quality Logs
        wq_query: dict = {}
        if tank_id: wq_query["tank_id"] = tank_id
        if project_id: wq_query["project_id"] = project_id
        wq_logs = await WaterQualityLog.find(wq_query).to_list()
        for log in wq_logs:
            if not date_filter({"date": log.date}): continue
            fac_name, room_name, tank_name, log_fac_id = resolve_location(log.tank_id)
            if facility_id and log_fac_id != facility_id: continue
            proj_obj = proj_map.get(str(log.project_id)) if log.project_id else None
            results.append({
                "date": log.date.isoformat(),
                "facility": fac_name, "room": room_name, "tank": tank_name,
                "project": log.project_id or "",
                "aupp_number": proj_obj.aupp_number if proj_obj else "N/A",
                "event_type": "Water Quality",
                "summary": f"{log.type}: {log.parameters}",
                "performed_by": log.created_by,
                "created_at": log.created_at.isoformat(),
            })

        # Incident Reports
        inc_query: dict = {}
        if tank_id: inc_query["tank_id"] = tank_id
        if project_id: inc_query["project_id"] = project_id
        incidents = await IncidentReport.find(inc_query).to_list()
        for inc in incidents:
            if not date_filter({"date": inc.date}): continue
            fac_name, room_name, tank_name, log_fac_id = resolve_location(inc.tank_id)
            if facility_id and log_fac_id != facility_id: continue
            proj_obj = proj_map.get(str(inc.project_id)) if inc.project_id else None
            results.append({
                "date": inc.date.isoformat(),
                "facility": fac_name, "room": room_name, "tank": tank_name,
                "project": inc.project_id or "",
                "aupp_number": proj_obj.aupp_number if proj_obj else "N/A",
                "event_type": "Incident",
                "summary": inc.problem,
                "performed_by": inc.created_by,
                "created_at": inc.created_at.isoformat(),
            })

        # Census Events
        census_query: dict = {}
        if tank_id: census_query["tank_id"] = tank_id
        if project_id: census_query["project_id"] = project_id
        censuses = await CensusEvent.find(census_query).to_list()
        for c in censuses:
            if not date_filter({"date": c.date}): continue
            fac_name, room_name, tank_name, log_fac_id = resolve_location(c.tank_id)
            if facility_id and log_fac_id != facility_id: continue
            proj_obj = proj_map.get(str(c.project_id)) if c.project_id else None
            results.append({
                "date": c.date.isoformat(),
                "facility": fac_name, "room": room_name, "tank": tank_name,
                "project": c.project_id or "",
                "aupp_number": proj_obj.aupp_number if proj_obj else "N/A",
                "event_type": "Census",
                "summary": f"{c.event_type}: {c.change}",
                "performed_by": c.created_by,
                "created_at": c.created_at.isoformat(),
            })

        # Project closures
        proj_query: dict = {"status": "closed"}
        if project_id: proj_query["_id"] = project_id
        closed_projects = await Project.find(proj_query).to_list()
        for p in closed_projects:
            closed_at = getattr(p, "closed_at", None)
            if closed_at and not date_filter({"date": closed_at}): continue
            proj_fac_name = "Unknown Facility"
            if p.room_number:
                match_room = next((r for r in rooms_list if r.room_number == p.room_number), None)
                if match_room:
                    if facility_id and match_room.facility_id != facility_id: continue
                    match_fac = fac_map.get(match_room.facility_id)
                    if match_fac: proj_fac_name = match_fac.name
            
            results.append({
                "date": closed_at.isoformat() if closed_at else "",
                "facility": proj_fac_name,
                "room": f"Room {p.room_number}" if p.room_number else "",
                "tank": "",
                "project": str(p.id),
                "aupp_number": p.aupp_number or "N/A",
                "event_type": "Project Closure",
                "summary": p.disposition_type or "",
                "performed_by": p.closed_by or "",
                "created_at": closed_at.isoformat() if closed_at else "",
            })

        results.sort(key=lambda x: x.get("created_at") or x["date"], reverse=True)

        user_ids = {r["performed_by"] for r in results if r.get("performed_by")}
        user_map = await EntityResolver.resolve_users_by_ids(list(user_ids))

        for r in results:
            uid = r["performed_by"]
            if uid:
                r["performed_by"] = user_map.get(uid, uid)

        return results

    @staticmethod
    async def get_executive_facility_summary(
        date_from: Optional[datetime],
        date_to: Optional[datetime],
        granularity: str,
        current_user: User
    ) -> Dict[str, Any]:
        all_census = await CensusEvent.find_all().to_list()
        all_projects = await Project.find_all().to_list()

        df_date = date_from.date() if date_from else None
        dt_date = date_to.date() if date_to else None

        starting_fish = 0
        if df_date:
            starting_fish = sum(c.change for c in all_census if c.date < df_date)
        starting_fish = max(0, starting_fish)

        window_census = []
        for c in all_census:
            if df_date and c.date < df_date: continue
            if dt_date and c.date > dt_date: continue
            window_census.append(c)

        total_arrivals = sum(c.change for c in window_census if c.event_type in ("arrival", "hatch") and c.change > 0)
        total_mortality = sum(abs(c.change) for c in window_census if c.event_type == "death")
        total_dispositions = sum(abs(c.change) for c in window_census if c.event_type == "manual_adjustment" and c.change < 0)

        net_window_change = sum(c.change for c in window_census)
        ending_fish = max(0, starting_fish + net_window_change)

        active_projects = sum(1 for p in all_projects if p.status == "active")

        return {
            "date_from": df_date.isoformat() if df_date else None,
            "date_to": dt_date.isoformat() if dt_date else None,
            "granularity": granularity,
            "starting_fish_count": starting_fish,
            "total_arrivals": total_arrivals,
            "total_mortality": total_mortality,
            "total_dispositions": total_dispositions,
            "ending_fish_count": ending_fish,
            "active_projects_count": active_projects,
            "total_events_logged": len(window_census),
        }
