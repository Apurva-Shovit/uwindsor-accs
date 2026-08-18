from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional
from ..models.user import User, StatusEnum
from ..models.project import Project
from ..models.facility import Tank
from ..models.incident_report import IncidentReport
from ..models.census_event import CensusEvent
from ..repositories.base_repository import BaseRepository
from ..services.audit_service import AuditService
from ..utils.quarantine_utils import lift_expired_quarantines

class DashboardService:
    """Service layer for Dashboard Aggregations."""

    @staticmethod
    async def get_dashboard_summary() -> Dict[str, Any]:
        await lift_expired_quarantines()
        user_repo = BaseRepository(User)
        project_repo = BaseRepository(Project)
        tank_repo = BaseRepository(Tank)
        incident_repo = BaseRepository(IncidentReport)
        census_repo = BaseRepository(CensusEvent)

        # Users
        users = await user_repo.find({"status": StatusEnum.active.value})
        total_active_users = len(users)
        
        # Projects
        projects = await project_repo.find({"status": "active"})
        active_projects = len(projects)
        
        # Pending approvals
        pending = await user_repo.find({"status": "pending"})
        pending_approvals = len(pending)

        # Identify tanks requiring attention due to incidents or deaths in the last 24 hours
        twenty_four_hours_ago_dt = datetime.now(timezone.utc) - timedelta(hours=24)
        twenty_four_hours_ago_date = twenty_four_hours_ago_dt.date()

        recent_24h_incidents = await incident_repo.find({
            "$or": [
                {"created_at": {"$gte": twenty_four_hours_ago_dt}},
                {"date": {"$gte": twenty_four_hours_ago_date}}
            ]
        })

        recent_24h_deaths = await census_repo.find({
            "event_type": "death",
            "$or": [
                {"created_at": {"$gte": twenty_four_hours_ago_dt}},
                {"date": {"$gte": twenty_four_hours_ago_date}}
            ]
        })

        # Collect attention details mapping: { tank_identifier: set of reasons }
        attention_map: Dict[str, set] = {}
        for inc in recent_24h_incidents:
            if getattr(inc, "tank_id", None):
                tid = str(inc.tank_id)
                if tid not in attention_map:
                    attention_map[tid] = set()
                attention_map[tid].add("Incident")

        for death in recent_24h_deaths:
            if getattr(death, "tank_id", None):
                tid = str(death.tank_id)
                if tid not in attention_map:
                    attention_map[tid] = set()
                attention_map[tid].add("Mortality")

        # Tank status distribution & detailed breakdowns
        tanks = await tank_repo.find({"deleted": False})
        healthy, quarantine, attention = 0, 0, 0
        quarantine_tanks = []
        attention_details = []
        total_active = 0

        def _sort_key(t):
            num = getattr(t, "tank_number", "")
            return int(num) if str(num).isdigit() else 999

        tanks_sorted = sorted(tanks, key=_sort_key)

        for t in tanks_sorted:
            if t.status == "inactive":
                continue

            total_active += 1
            t_id_str = str(t.id)
            t_num_str = str(t.tank_number) if hasattr(t, "tank_number") and t.tank_number else t_id_str
            tank_label = f"Tank {t_num_str}" if t_num_str and not str(t_num_str).lower().startswith("tank") else (t_num_str or "Unknown")

            att_reasons = set()
            if t_id_str in attention_map:
                att_reasons.update(attention_map[t_id_str])
            if t_num_str in attention_map:
                att_reasons.update(attention_map[t_num_str])

            needs_att = len(att_reasons) > 0

            if t.is_quarantined:
                quarantine += 1
                quarantine_tanks.append(tank_label)
            if needs_att:
                attention += 1
                attention_details.append({
                    "tank": tank_label,
                    "reason": " & ".join(sorted(list(att_reasons)))
                })
            if not t.is_quarantined and not needs_att:
                healthy += 1
                
        # Recent incidents (last 7 days)
        seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
        incidents = await incident_repo.find({"date": {"$gte": seven_days_ago}})
        recent_incidents = len(incidents)

        return {
            "users": total_active_users,
            "projects": active_projects,
            "pending_approvals": pending_approvals,
            "tank_status": {
                "healthy": healthy,
                "quarantine": quarantine,
                "attention": attention,
                "total_active": total_active,
                "quarantine_tanks": quarantine_tanks,
                "attention_details": attention_details,
            },
            "recent_incidents": recent_incidents,
        }

    @staticmethod
    async def get_dashboard_activity(skip: int, limit: int) -> List[Dict[str, Any]]:
        # Reuse the existing robust AuditService which handles EntityResolver
        return await AuditService.get_audit_logs(skip, limit)

    @staticmethod
    async def get_water_quality_analytics(tank_id: Optional[str] = None, days: int = 30) -> Dict[str, Any]:
        from ..models.water_quality_log import WaterQualityLog
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        
        query: dict = {"date": {"$gte": cutoff}}
        if tank_id and tank_id != "all":
            if tank_id in ("group_1_8", "group_9_14"):
                all_tanks_objs = await Tank.find({"deleted": False}).to_list()
                if tank_id == "group_1_8":
                    matched_ids = [str(t.id) for t in all_tanks_objs if str(t.tank_number).isdigit() and 1 <= int(t.tank_number) <= 8]
                else:
                    matched_ids = [str(t.id) for t in all_tanks_objs if str(t.tank_number).isdigit() and 9 <= int(t.tank_number) <= 14]
                query["tank_id"] = {"$in": matched_ids}
            else:
                query["tank_id"] = tank_id

        logs = await WaterQualityLog.find(query).sort("+date").to_list()
        
        # Group logs by date string (YYYY-MM-DD)
        daily_map: Dict[str, Dict[str, Any]] = {}
        
        for wq in logs:
            date_str = wq.date.strftime("%Y-%m-%d") if isinstance(wq.date, datetime) else str(wq.date)[:10]
            if date_str not in daily_map:
                daily_map[date_str] = {
                    "date": date_str,
                    "ph_values": [],
                    "temp_values": [],
                    "do_values": [],
                    "log_count": 0
                }
            
            params = getattr(wq, "parameters", {}) or {}
            ph_val = params.get("ph") if params.get("ph") is not None else params.get("pH")
            temp_val = params.get("temperature") if params.get("temperature") is not None else (params.get("temperature_celsius") or params.get("temp"))
            do_val = params.get("dissolved_oxygen") if params.get("dissolved_oxygen") is not None else params.get("do")

            if ph_val is not None:
                try: daily_map[date_str]["ph_values"].append(float(ph_val))
                except (ValueError, TypeError): pass
            if temp_val is not None:
                try: daily_map[date_str]["temp_values"].append(float(temp_val))
                except (ValueError, TypeError): pass
            if do_val is not None:
                try: daily_map[date_str]["do_values"].append(float(do_val))
                except (ValueError, TypeError): pass
            
            daily_map[date_str]["log_count"] += 1

        # Walk every calendar day in the range (not just days that have a log) so
        # days with zero entries show up as explicit gaps instead of being silently
        # omitted from the series and compressing the chart's timeline.
        start_date = cutoff.date()
        end_date = datetime.now(timezone.utc).date()
        num_days = max(0, (end_date - start_date).days + 1)
        calendar_dates = { (start_date + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(num_days) }
        all_date_strs = sorted(calendar_dates.union(daily_map.keys()))

        series = []
        for d_str in all_date_strs:
            entry = daily_map.get(d_str)

            if entry:
                avg_ph = round(sum(entry["ph_values"]) / len(entry["ph_values"]), 2) if entry["ph_values"] else None
                avg_temp = round(sum(entry["temp_values"]) / len(entry["temp_values"]), 1) if entry["temp_values"] else None
                avg_do = round(sum(entry["do_values"]) / len(entry["do_values"]), 1) if entry["do_values"] else None
                log_count = entry["log_count"]
            else:
                avg_ph = avg_temp = avg_do = None
                log_count = 0

            series.append({
                "date": d_str,
                "ph": avg_ph,
                "temperature": avg_temp,
                "dissolved_oxygen": avg_do,
                "log_count": log_count,
                "has_entry": log_count > 0,
            })

        all_tanks = await Tank.find({"deleted": False}).to_list()
        tank_options = [{"id": str(t.id), "tank_number": t.tank_number} for t in sorted(all_tanks, key=lambda x: int(x.tank_number) if str(x.tank_number).isdigit() else 999)]

        # Compute summary stats for each parameter
        def calc_param_stats(key: str, precision: int = 2):
            vals = [s[key] for s in series if s[key] is not None]
            if not vals:
                return {"min": None, "max": None, "mid": None, "latest": None, "has_data": False}
            min_val = round(min(vals), precision)
            max_val = round(max(vals), precision)
            mid_val = round((min_val + max_val) / 2, precision)
            latest_val = round(vals[-1], precision)
            return {
                "min": min_val,
                "max": max_val,
                "mid": mid_val,
                "latest": latest_val,
                "has_data": True
            }

        summary_stats = {
            "ph": calc_param_stats("ph", 2),
            "temperature": calc_param_stats("temperature", 1),
            "dissolved_oxygen": calc_param_stats("dissolved_oxygen", 1)
        }

        groups = [
            {"id": "group_1_8", "label": "Tanks 1 - 8 (Group)"},
            {"id": "group_9_14", "label": "Tanks 9 - 14 (Group)"}
        ]

        return {
            "time_range_days": days,
            "selected_tank_id": tank_id or "all",
            "groups": groups,
            "tank_options": tank_options,
            "summary_stats": summary_stats,
            "series": series
        }

