import csv
import json
import zipfile
from datetime import date, datetime, time, timedelta, timezone
from io import BytesIO, StringIO
from typing import Any, Dict, List, Optional

from bson import ObjectId

from ..models.audit_log import AuditLog
from ..models.census_event import CensusEvent
from ..models.facility import Facility, Room, Tank
from ..models.incident_report import IncidentReport
from ..models.individual_fish import IndividualFish
from ..models.project import Project
from ..models.quarantine import QuarantineExemption
from ..models.species import Species
from ..models.tank_assignment import TankAssignment
from ..models.user import User
from ..models.water_quality_log import WaterQualityLog
from ..repositories.audit_repository import AuditRepository

# Single source of truth for the export bundle: which collections exist, whether
# they're always exported in full ("static"), and which field (if any) scopes
# them to a requested date range.
COLLECTIONS: Dict[str, Dict[str, Any]] = {
    "users": {"model": User, "static": True},
    "facilities": {"model": Facility, "static": True},
    "rooms": {"model": Room, "static": True},
    "tanks": {"model": Tank, "static": True},
    "species": {"model": Species, "static": True},
    "projects": {"model": Project, "static": False, "date_field": "created_at"},
    "tank_assignments": {"model": TankAssignment, "static": False, "date_field": "created_at"},
    "individual_fish": {"model": IndividualFish, "static": False, "date_field": "created_at"},
    "census_events": {"model": CensusEvent, "static": False, "date_field": "date"},
    "water_quality_logs": {"model": WaterQualityLog, "static": False, "date_field": "date"},
    "incident_reports": {"model": IncidentReport, "static": False, "date_field": "date"},
    "quarantine_exemptions": {"model": QuarantineExemption, "static": False, "date_field": "requested_at"},
    "audit_logs": {"model": AuditLog, "static": False, "date_field": "created_at"},
}

# Reference-field -> resolved-column-label, used only for the CSV (human) export.
# The JSON export keeps raw ids only, since it's meant for recovery, not reading.
_USER_REF_FIELDS = {
    "created_by", "updated_by", "deleted_by", "actor_id",
    "requested_by", "decided_by", "approved_by", "closed_by",
}
_TANK_REF_FIELDS = {"tank_id", "target_tank_id"}
_ROOM_REF_FIELDS = {"room_id"}
_FACILITY_REF_FIELDS = {"facility_id"}
_PROJECT_REF_FIELDS = {"project_id"}


def _json_safe(value: Any) -> Any:
    """Recursively converts a value into JSON-safe primitives. Needed because
    free-form dict fields (e.g. AuditLog.before/after) can contain raw
    bson.ObjectId or datetime values that Pydantic's model_dump(mode="json")
    cannot handle once they're nested inside an untyped dict - it only
    special-cases types it recognizes from the schema, not arbitrary content."""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, ObjectId):
        return str(value)
    return value


class ExportService:
    """Service layer for the full-database backup/export feature."""

    @staticmethod
    def _build_date_query(field: str, start_date: Optional[date], end_date: Optional[date]) -> dict:
        if not start_date and not end_date:
            return {}
        bounds: Dict[str, datetime] = {}
        if start_date:
            bounds["$gte"] = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
        if end_date:
            bounds["$lt"] = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=timezone.utc)
        return {field: bounds}

    @staticmethod
    async def get_preview_counts(start_date: Optional[date], end_date: Optional[date]) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for name, spec in COLLECTIONS.items():
            model = spec["model"]
            if spec["static"]:
                counts[name] = await model.find_all().count()
            else:
                query = ExportService._build_date_query(spec["date_field"], start_date, end_date)
                counts[name] = await model.find(query).count() if query else await model.find_all().count()
        return counts

    @staticmethod
    async def build_export_bundle(start_date: Optional[date], end_date: Optional[date]) -> Dict[str, List[dict]]:
        """Fetches every collection into one bundle. Static entities are always
        full; transactional entities are scoped to the date range if provided.
        Raises on any query failure - callers must not persist a partial bundle."""
        bundle: Dict[str, List[dict]] = {}
        for name, spec in COLLECTIONS.items():
            model = spec["model"]
            if spec["static"]:
                docs = await model.find_all().to_list()
            else:
                query = ExportService._build_date_query(spec["date_field"], start_date, end_date)
                docs = await model.find(query).to_list() if query else await model.find_all().to_list()
            bundle[name] = [_json_safe(doc.model_dump(mode="python")) for doc in docs]
        return bundle

    @staticmethod
    def generate_json_export(bundle: Dict[str, List[dict]]) -> bytes:
        """Full-fidelity machine export, including password_hash - required so a
        future importer can reconstruct the database exactly. Treat as a secret."""
        return json.dumps(bundle, default=str, ensure_ascii=False, indent=2).encode("utf-8")

    @staticmethod
    def _flatten_value(value: Any) -> Any:
        if value is None:
            return ""
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (dict, list)):
            return json.dumps(value, default=str, ensure_ascii=False)
        return value

    @staticmethod
    def _extra_label(column: str) -> Optional[str]:
        if column in _USER_REF_FIELDS:
            return f"{column}_name"
        if column in _TANK_REF_FIELDS:
            return column.replace("_id", "_number")
        if column in _ROOM_REF_FIELDS:
            return "room_number"
        if column in _FACILITY_REF_FIELDS:
            return "facility_name"
        if column in _PROJECT_REF_FIELDS:
            return "project_title"
        return None

    @staticmethod
    def _collection_columns(name: str, rows: List[dict]) -> List[str]:
        if rows:
            return list(rows[0].keys())
        return list(COLLECTIONS[name]["model"].model_fields.keys())

    @staticmethod
    def _write_collection_sheet(zf: zipfile.ZipFile, name: str, rows: List[dict], resolve) -> None:
        base_columns = ExportService._collection_columns(name, rows)
        if name == "users":
            base_columns = [c for c in base_columns if c != "password_hash"]

        extra_columns: List[tuple] = []
        seen_labels = set()
        for col in base_columns:
            label = ExportService._extra_label(col)
            if label and label not in seen_labels:
                extra_columns.append((col, label))
                seen_labels.add(label)

        buf = StringIO()
        writer = csv.writer(buf)
        writer.writerow(base_columns + [label for _, label in extra_columns])
        for row in rows:
            line = [ExportService._flatten_value(row.get(c)) for c in base_columns]
            for col, _ in extra_columns:
                line.append(resolve(col, row.get(col)) or "")
            writer.writerow(line)
        zf.writestr(f"{name}.csv", buf.getvalue())

    @staticmethod
    def _write_manifest(zf: zipfile.ZipFile, meta: Dict[str, Any], record_counts: Dict[str, int]) -> None:
        buf = StringIO()
        writer = csv.writer(buf)
        writer.writerow(["ACARE Data Export Manifest"])
        writer.writerow(["Generated At (UTC)", meta["generated_at"]])
        writer.writerow(["Exported By", meta["actor_name"]])
        writer.writerow(["Scope", meta["scope"]])
        writer.writerow([])
        writer.writerow(["Collection", "Record Count"])
        for collection_name, count in record_counts.items():
            writer.writerow([collection_name, count])
        zf.writestr("manifest.csv", buf.getvalue())

    @staticmethod
    def generate_csv_export(bundle: Dict[str, List[dict]], meta: Dict[str, Any]) -> BytesIO:
        """Human-readable export: one CSV per collection + a manifest, zipped.
        Excludes password_hash. Id -> name lookups are built once from the bundle
        itself (users/tanks/rooms/facilities/projects are always exported in
        full), so no extra database queries are needed."""
        user_map = {
            u["id"]: (f"{u.get('first_name', '')} {u.get('last_name', '')}".strip() or u.get("email", "Unknown User"))
            for u in bundle.get("users", [])
        }
        tank_map = {t["id"]: f"Tank {t.get('tank_number')}" for t in bundle.get("tanks", [])}
        room_map = {r["id"]: f"Room {r.get('room_number')}" for r in bundle.get("rooms", [])}
        facility_map = {f["id"]: f.get("name", "Unknown Facility") for f in bundle.get("facilities", [])}
        project_map = {p["id"]: p.get("title", "Unknown Project") for p in bundle.get("projects", [])}

        def resolve(field: str, value: Any) -> Optional[str]:
            if not value or not isinstance(value, str):
                return None
            if field in _USER_REF_FIELDS:
                return user_map.get(value, "Unknown User")
            if field in _TANK_REF_FIELDS:
                return tank_map.get(value, "Unknown Tank")
            if field in _ROOM_REF_FIELDS:
                return room_map.get(value, "Unknown Room")
            if field in _FACILITY_REF_FIELDS:
                return facility_map.get(value, "Unknown Facility")
            if field in _PROJECT_REF_FIELDS:
                return project_map.get(value, "Unknown Project")
            return None

        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            record_counts = {name: len(rows) for name, rows in bundle.items()}
            for name, rows in bundle.items():
                ExportService._write_collection_sheet(zf, name, rows, resolve)
            ExportService._write_manifest(zf, meta, record_counts)
        zip_buffer.seek(0)
        return zip_buffer

    @staticmethod
    async def write_export_audit_log(
        actor: User,
        export_format: str,
        start_date: Optional[date],
        end_date: Optional[date],
        record_counts: Dict[str, int],
    ) -> None:
        await AuditRepository.insert(AuditLog(
            actor_id=str(actor.id),
            actor_role=actor.role.value if actor.role else "none",
            action="data_export",
            entity_type="system",
            entity_id="export",
            after={
                "format": export_format,
                "start_date": start_date.isoformat() if start_date else None,
                "end_date": end_date.isoformat() if end_date else None,
                "record_counts": record_counts,
            },
        ))
