from typing import List, Dict, Any
from datetime import datetime
from ..models.user import AuditLog
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
                return f"Tank {t.tank_number}" if t else entity_id
            elif entity_type == "project":
                p = await Project.get(entity_id)
                return f"Project '{p.title}'" if p else entity_id
            elif entity_type == "tank_assignment":
                ta = await TankAssignment.get(entity_id)
                if ta:
                    t = await Tank.get(ta.tank_id)
                    return f"Assignment on Tank {t.tank_number if t else 'Unknown'}"
            elif entity_type == "census_event":
                ce = await CensusEvent.get(entity_id)
                if ce:
                    t = await Tank.get(ce.tank_id)
                    return f"Census for Tank {t.tank_number if t else 'Unknown'}"
            elif entity_type == "water_quality_log":
                wql = await WaterQualityLog.get(entity_id)
                if wql:
                    t = await Tank.get(wql.tank_id)
                    return f"Water Quality for Tank {t.tank_number if t else 'Unknown'}"
            elif entity_type == "incident_report":
                inc = await IncidentReport.get(entity_id)
                if inc:
                    t = await Tank.get(inc.tank_id)
                    return f"Incident on Tank {t.tank_number if t else 'Unknown'}"
            elif entity_type == "quarantine_exemption":
                qe = await QuarantineExemption.get(entity_id)
                if qe:
                    t = await Tank.get(qe.tank_id)
                    return f"Exemption for Tank {t.tank_number if t else 'Unknown'}"
        except Exception:
            pass
            
        return entity_id
