from typing import List, Dict, Any
from datetime import datetime
from ..models.audit_log import AuditLog
from ..models.facility import Tank
from ..models.project import Project
from ..models.tank_assignment import TankAssignment
from ..models.census_event import CensusEvent
from ..models.water_quality_log import WaterQualityLog
from ..models.incident_report import IncidentReport
from ..models.quarantine import QuarantineExemption
from bson import ObjectId

class AuditRepository:
    """Repository pattern abstracting direct Beanie calls for Audit Logs."""

    @staticmethod
    async def get_logs_with_pagination(
        query: Dict[str, Any], 
        skip: int, 
        limit: int
    ) -> List[AuditLog]:
        return await AuditLog.find(query).sort("-created_at").skip(skip).limit(limit).to_list()

    @staticmethod
    async def insert(log: AuditLog) -> AuditLog:
        await log.insert()
        return log

    @staticmethod
    async def get_entity_display_name(entity_type: str, entity_id: str) -> str:
        """Fetches the entity from the DB to construct its display name."""
        if not ObjectId.is_valid(entity_id):
            return entity_id

        try:
            if entity_type == "tank":
                t = await Tank.get(entity_id)
                return f"Tank {t.tank_number}" if t else "Unknown Tank"
            elif entity_type == "project":
                p = await Project.get(entity_id)
                return f"Project '{p.title}'" if p else "Unknown Project"
            elif entity_type == "tank_assignment":
                ta = await TankAssignment.get(entity_id)
                if ta:
                    t = await Tank.get(ta.tank_id)
                    return f"Assignment on Tank {t.tank_number if t else 'Unknown'}"
                return "Unknown Assignment"
            elif entity_type == "census_event":
                ce = await CensusEvent.get(entity_id)
                if ce:
                    t = await Tank.get(ce.tank_id)
                    return f"Census for Tank {t.tank_number if t else 'Unknown'}"
                return "Unknown Census Event"
            elif entity_type == "water_quality_log":
                wql = await WaterQualityLog.get(entity_id)
                if wql:
                    t = await Tank.get(wql.tank_id)
                    return f"Water Quality for Tank {t.tank_number if t else 'Unknown'}"
                return "Unknown Water Quality Log"
            elif entity_type == "incident_report":
                inc = await IncidentReport.get(entity_id)
                if inc:
                    t = await Tank.get(inc.tank_id)
                    return f"Incident on Tank {t.tank_number if t else 'Unknown'}"
                return "Unknown Incident Report"
            elif entity_type == "quarantine_exemption":
                qe = await QuarantineExemption.get(entity_id)
                if qe:
                    t = await Tank.get(qe.tank_id)
                    return f"Exemption for Tank {t.tank_number if t else 'Unknown'}"
                return "Unknown Quarantine Exemption"
            elif entity_type == "facility":
                from ..models.facility import Facility
                fac = await Facility.get(entity_id)
                return f"Facility '{fac.name}'" if fac else "Unknown Facility"
            elif entity_type == "room":
                from ..models.facility import Room
                rm = await Room.get(entity_id)
                return f"Room {rm.room_number}" if rm else "Unknown Room"
            elif entity_type == "species":
                from ..models.species import Species
                sp = await Species.get(entity_id)
                return f"Species '{sp.name}'" if sp else "Unknown Species"
            elif entity_type in ["notification_settings", "water_quality_cutoff", "notification_cutoff"]:
                if entity_id and not ObjectId.is_valid(entity_id):
                    return entity_id
                return "Water Quality Cutoff"
            elif entity_type == "user":
                from ..models.user import User
                u = await User.get(entity_id)
                if u:
                    return f"{u.first_name} {u.last_name}".strip()
                return "Unknown User"
        except Exception:
            pass
            
        return f"Unknown {entity_type.replace('_', ' ').title()}" if ObjectId.is_valid(entity_id) else entity_id

    @staticmethod
    async def get_entity_display_names_bulk(
        entity_refs: List[tuple[str, str]]
    ) -> Dict[tuple[str, str], str]:
        """Batch-resolves display names for a list of (entity_type, entity_id) pairs."""
        from collections import defaultdict
        grouped: Dict[str, List[str]] = defaultdict(list)
        for etype, eid in entity_refs:
            if eid and ObjectId.is_valid(eid):
                grouped[etype].append(eid)

        result: Dict[tuple[str, str], str] = {}

        if "facility" in grouped and grouped["facility"]:
            from ..models.facility import Facility
            facs = await Facility.find({"_id": {"$in": [ObjectId(i) for i in grouped["facility"]]}}).to_list()
            f_map = {str(f.id): f"Facility '{f.name}'" for f in facs}
            for eid in grouped["facility"]:
                result[("facility", eid)] = f_map.get(eid, "Unknown Facility")

        if "room" in grouped and grouped["room"]:
            from ..models.facility import Room
            rooms = await Room.find({"_id": {"$in": [ObjectId(i) for i in grouped["room"]]}}).to_list()
            r_map = {str(r.id): f"Room {r.room_number}" for r in rooms}
            for eid in grouped["room"]:
                result[("room", eid)] = r_map.get(eid, "Unknown Room")

        if "species" in grouped and grouped["species"]:
            from ..models.species import Species
            species_list = await Species.find({"_id": {"$in": [ObjectId(i) for i in grouped["species"]]}}).to_list()
            sp_map = {str(s.id): f"Species '{s.name}'" for s in species_list}
            for eid in grouped["species"]:
                result[("species", eid)] = sp_map.get(eid, "Unknown Species")

        if "tank" in grouped and grouped["tank"]:
            tanks = await Tank.find({"_id": {"$in": [ObjectId(i) for i in grouped["tank"]]}}).to_list()
            t_map = {str(t.id): f"Tank {t.tank_number}" for t in tanks}
            for eid in grouped["tank"]:
                result[("tank", eid)] = t_map.get(eid, "Unknown Tank")

        if "project" in grouped and grouped["project"]:
            projs = await Project.find({"_id": {"$in": [ObjectId(i) for i in grouped["project"]]}}).to_list()
            p_map = {str(p.id): f"Project '{p.title}'" for p in projs}
            for eid in grouped["project"]:
                result[("project", eid)] = p_map.get(eid, "Unknown Project")

        if "tank_assignment" in grouped and grouped["tank_assignment"]:
            tas = await TankAssignment.find({"_id": {"$in": [ObjectId(i) for i in grouped["tank_assignment"]]}}).to_list()
            tank_ids = [ta.tank_id for ta in tas if ta.tank_id and ObjectId.is_valid(ta.tank_id)]
            tanks = await Tank.find({"_id": {"$in": [ObjectId(i) for i in tank_ids]}}).to_list() if tank_ids else []
            t_map = {str(t.id): t.tank_number for t in tanks}
            for ta in tas:
                t_num = t_map.get(ta.tank_id, "Unknown")
                result[("tank_assignment", str(ta.id))] = f"Assignment on Tank {t_num}"

        if "census_event" in grouped and grouped["census_event"]:
            ces = await CensusEvent.find({"_id": {"$in": [ObjectId(i) for i in grouped["census_event"]]}}).to_list()
            tank_ids = [ce.tank_id for ce in ces if ce.tank_id and ObjectId.is_valid(ce.tank_id)]
            tanks = await Tank.find({"_id": {"$in": [ObjectId(i) for i in tank_ids]}}).to_list() if tank_ids else []
            t_map = {str(t.id): t.tank_number for t in tanks}
            for ce in ces:
                t_num = t_map.get(ce.tank_id, "Unknown")
                result[("census_event", str(ce.id))] = f"Census for Tank {t_num}"

        if "water_quality_log" in grouped and grouped["water_quality_log"]:
            wqls = await WaterQualityLog.find({"_id": {"$in": [ObjectId(i) for i in grouped["water_quality_log"]]}}).to_list()
            tank_ids = [wql.tank_id for wql in wqls if wql.tank_id and ObjectId.is_valid(wql.tank_id)]
            tanks = await Tank.find({"_id": {"$in": [ObjectId(i) for i in tank_ids]}}).to_list() if tank_ids else []
            t_map = {str(t.id): t.tank_number for t in tanks}
            for wql in wqls:
                t_num = t_map.get(wql.tank_id, "Unknown")
                result[("water_quality_log", str(wql.id))] = f"Water Quality for Tank {t_num}"

        if "incident_report" in grouped and grouped["incident_report"]:
            incs = await IncidentReport.find({"_id": {"$in": [ObjectId(i) for i in grouped["incident_report"]]}}).to_list()
            tank_ids = [inc.tank_id for inc in incs if inc.tank_id and ObjectId.is_valid(inc.tank_id)]
            tanks = await Tank.find({"_id": {"$in": [ObjectId(i) for i in tank_ids]}}).to_list() if tank_ids else []
            t_map = {str(t.id): t.tank_number for t in tanks}
            for inc in incs:
                t_num = t_map.get(inc.tank_id, "Unknown")
                result[("incident_report", str(inc.id))] = f"Incident on Tank {t_num}"

        if "quarantine_exemption" in grouped and grouped["quarantine_exemption"]:
            qes = await QuarantineExemption.find({"_id": {"$in": [ObjectId(i) for i in grouped["quarantine_exemption"]]}}).to_list()
            tank_ids = [qe.tank_id for qe in qes if qe.tank_id and ObjectId.is_valid(qe.tank_id)]
            tanks = await Tank.find({"_id": {"$in": [ObjectId(i) for i in tank_ids]}}).to_list() if tank_ids else []
            t_map = {str(t.id): t.tank_number for t in tanks}
            for qe in qes:
                t_num = t_map.get(qe.tank_id, "Unknown")
                result[("quarantine_exemption", str(qe.id))] = f"Exemption for Tank {t_num}"

        return result
