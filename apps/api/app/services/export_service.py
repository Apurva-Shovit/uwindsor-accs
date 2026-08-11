import csv
import json
import re
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

_ACTION_HUMAN_MAP = {
    "user_signup": "Signed Up User Account",
    "user_approve": "Approved User Account",
    "user_reject": "Rejected User Account",
    "user_role_update": "Updated User Role",
    "user_status_update": "Updated User Status",
    "user_tank_assignments_update": "Updated User Tank Assignments",
    "login": "User Logged In",
    "logout": "User Logged Out",
    "login_failed": "Failed Login Attempt",
    "login_blocked": "Blocked Login Attempt",
    "placed_in_quarantine": "Placed Tank in Quarantine",
    "lifted_quarantine": "Lifted Tank Quarantine",
    "quarantine_exemption_request": "Requested Quarantine Exemption",
    "quarantine_exemption_approve": "Approved Quarantine Exemption",
    "quarantine_exemption_reject": "Rejected Quarantine Exemption",
    "individual_fish_register": "Registered Individual Fish Tag",
    "data_export": "Exported System Data",
    "close": "Closed Project",
}

HEX_OBJECT_ID_REGEX = re.compile(r"^[0-9a-fA-F]{24}$")

# Explicit CSV column schemas: list of (field_key, display_header, format_type)
COLLECTION_SCHEMAS: Dict[str, List[tuple]] = {
    "users": [
        ("first_name", "First Name", "text"),
        ("last_name", "Last Name", "text"),
        ("email", "Email", "text"),
        ("role", "Role", "text"),
        ("requested_role", "Requested Role", "text"),
        ("status", "Status", "text"),
        ("facility_ids", "Assigned Facilities", "id_facility_list"),
        ("room_ids", "Assigned Rooms", "id_room_list"),
        ("assigned_tank_ids", "Assigned Tanks", "id_tank_list"),
        ("approved_by", "Approved By", "id_user"),
        ("approved_at", "Approved At", "datetime"),
        ("rejection_reason", "Rejection Reason", "text"),
        ("created_at", "Created At", "datetime"),
        ("created_by", "Created By", "id_user"),
        ("updated_at", "Updated At", "datetime"),
        ("updated_by", "Updated By", "id_user"),
        ("deleted", "Deleted", "boolean"),
        ("deleted_at", "Deleted At", "datetime"),
        ("deleted_by", "Deleted By", "id_user"),
    ],
    "facilities": [
        ("name", "Facility Name", "text"),
        ("address", "Address", "text"),
        ("description", "Description", "text"),
        ("active", "Active", "boolean"),
        ("created_at", "Created At", "datetime"),
        ("created_by", "Created By", "id_user"),
        ("updated_at", "Updated At", "datetime"),
        ("updated_by", "Updated By", "id_user"),
        ("deleted", "Deleted", "boolean"),
        ("deleted_at", "Deleted At", "datetime"),
        ("deleted_by", "Deleted By", "id_user"),
    ],
    "rooms": [
        ("room_number", "Room Number", "text"),
        ("facility_id", "Facility", "id_facility"),
        ("description", "Description", "text"),
        ("active", "Active", "boolean"),
        ("created_at", "Created At", "datetime"),
        ("created_by", "Created By", "id_user"),
        ("updated_at", "Updated At", "datetime"),
        ("updated_by", "Updated By", "id_user"),
        ("deleted", "Deleted", "boolean"),
        ("deleted_at", "Deleted At", "datetime"),
        ("deleted_by", "Deleted By", "id_user"),
    ],
    "tanks": [
        ("tank_number", "Tank Number", "text"),
        ("room_id", "Room", "id_room"),
        ("status", "Status", "text"),
        ("is_quarantined", "Is Quarantined", "boolean"),
        ("quarantine_start_date", "Quarantine Start Date", "datetime"),
        ("quarantine_end_date", "Quarantine End Date", "datetime"),
        ("notes", "Notes", "text"),
        ("created_at", "Created At", "datetime"),
        ("created_by", "Created By", "id_user"),
        ("updated_at", "Updated At", "datetime"),
        ("updated_by", "Updated By", "id_user"),
        ("deleted", "Deleted", "boolean"),
        ("deleted_at", "Deleted At", "datetime"),
        ("deleted_by", "Deleted By", "id_user"),
    ],
    "species": [
        ("name", "Species Name", "text"),
        ("created_at", "Created At", "datetime"),
        ("created_by", "Created By", "id_user"),
    ],
    "projects": [
        ("title", "Project Title", "text"),
        ("pi_name", "PI Name", "text"),
        ("aupp_number", "AUPP Number", "text"),
        ("status", "Status", "text"),
        ("rfid_tracking_enabled", "RFID Tracking Enabled", "boolean"),
        ("species", "Species", "text"),
        ("sex", "Sex", "text"),
        ("dob", "Date of Birth / Hatch", "date_only"),
        ("established_date", "Established Date", "date_only"),
        ("source", "Source", "text"),
        ("aupp_expiry_date", "AUPP Expiry Date", "date_only"),
        ("room_number", "Room Number", "text"),
        ("closed_at", "Closed At", "datetime"),
        ("closed_by", "Closed By", "id_user"),
        ("disposition_type", "Disposition Type", "text"),
        ("disposition_notes", "Disposition Notes", "text"),
        ("created_at", "Created At", "datetime"),
        ("created_by", "Created By", "id_user"),
    ],
    "tank_assignments": [
        ("project_id", "Project Title", "id_project"),
        ("tank_id", "Tank Number", "id_tank"),
        ("current_count", "Current Fish Count", "text"),
        ("pi_name", "PI Name", "text"),
        ("aupp_number", "AUPP Number", "text"),
        ("created_at", "Created At", "datetime"),
        ("created_by", "Created By", "id_user"),
    ],
    "individual_fish": [
        ("fish_id", "Fish Tag ID", "text"),
        ("rfid_tag", "RFID Tag", "text"),
        ("species", "Species", "text"),
        ("tank_id", "Tank Number", "id_tank"),
        ("project_id", "Project Title", "id_project"),
        ("dob", "Date of Birth", "date_only"),
        ("sex", "Sex", "text"),
        ("status", "Status", "text"),
        ("notes", "Notes", "text"),
        ("created_at", "Created At", "datetime"),
        ("created_by", "Created By", "id_user"),
        ("updated_at", "Updated At", "datetime"),
        ("updated_by", "Updated By", "id_user"),
        ("deleted", "Deleted", "boolean"),
        ("deleted_at", "Deleted At", "datetime"),
        ("deleted_by", "Deleted By", "id_user"),
    ],
    "census_events": [
        ("date", "Date", "date_only"),
        ("project_id", "Project Title", "id_project"),
        ("tank_id", "Tank Number", "id_tank"),
        ("event_type", "Event Type", "text"),
        ("change", "Count Change", "count_change"),
        ("reason", "Reason", "text"),
        ("notes", "Notes", "text"),
        ("transfer_group_id", "Transfer Group ID", "text"),
        ("created_at", "Logged At", "datetime"),
        ("created_by", "Logged By", "id_user"),
    ],
    "incident_reports": [
        ("date", "Date", "date_only"),
        ("tank_id", "Tank Number", "id_tank"),
        ("project_id", "Project Title", "id_project"),
        ("problem", "Problem Summary", "text"),
        ("treatment", "Treatment / Action", "text"),
        ("comments", "Comments", "text"),
        ("aquatic_condition_checked", "Aquatic Condition Checked", "boolean"),
        ("vet_contacted", "Vet Contacted", "boolean"),
        ("researcher_notified", "Researcher Notified", "boolean"),
        ("created_at", "Reported At", "datetime"),
        ("created_by", "Reported By", "id_user"),
    ],
    "quarantine_exemptions": [
        ("tank_id", "Source Tank", "id_tank"),
        ("target_tank_id", "Target Tank", "id_tank"),
        ("project_id", "Project Title", "id_project"),
        ("fish_count", "Fish Count", "text"),
        ("reason", "Reason", "text"),
        ("urgency", "Urgency", "text"),
        ("status", "Status", "text"),
        ("requested_by", "Requested By", "id_user"),
        ("requested_at", "Requested At", "datetime"),
        ("decided_by", "Decided By", "id_user"),
        ("decided_at", "Decided At", "datetime"),
        ("rejection_reason", "Rejection Reason", "text"),
        ("created_at", "Created At", "datetime"),
        ("created_by", "Created By", "id_user"),
        ("updated_at", "Updated At", "datetime"),
        ("updated_by", "Updated By", "id_user"),
        ("deleted", "Deleted", "boolean"),
        ("deleted_at", "Deleted At", "datetime"),
        ("deleted_by", "Deleted By", "id_user"),
    ],
    "audit_logs": [
        ("created_at", "Timestamp", "datetime"),
        ("actor_id", "Actor Name", "id_user"),
        ("actor_role", "Actor Role", "text"),
        ("action", "Action", "action_human"),
        ("entity_type", "Entity Type", "text"),
        ("entity_id", "Target Entity Name", "id_polymorphic"),
        ("before", "State Before", "state_diff"),
        ("after", "State After", "state_diff"),
    ],
}


def _json_safe(value: Any) -> Any:
    """Recursively converts a value into JSON-safe primitives."""
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
        """Fetches every collection into one bundle."""
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
        """Full-fidelity machine export for disaster recovery."""
        return json.dumps(bundle, default=str, ensure_ascii=False, indent=2).encode("utf-8")

    @staticmethod
    def _format_date_val(val: Any, include_time: bool = True) -> str:
        if val is None or val == "":
            return "N/A"
        if isinstance(val, datetime):
            return val.strftime("%a, %b %d, %Y, %I:%M %p") if include_time else val.strftime("%a, %b %d, %Y")
        if isinstance(val, date):
            return val.strftime("%a, %b %d, %Y")
        if isinstance(val, str):
            try:
                dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
                return dt.strftime("%a, %b %d, %Y, %I:%M %p") if include_time else dt.strftime("%a, %b %d, %Y")
            except Exception:
                try:
                    d = date.fromisoformat(val)
                    return d.strftime("%a, %b %d, %Y")
                except Exception:
                    return str(val)
        return str(val)

    @staticmethod
    def _format_boolean_val(val: Any) -> str:
        if val is None or val == "":
            return "N/A"
        if isinstance(val, bool):
            return "Yes" if val else "No"
        if isinstance(val, str):
            lower = val.strip().lower()
            if lower in ("true", "1", "yes"):
                return "Yes"
            if lower in ("false", "0", "no"):
                return "No"
        return "Yes" if bool(val) else "No"

    @staticmethod
    def _format_json_dict_val(val: Any) -> str:
        if val is None or val == "":
            return "N/A"
        if isinstance(val, dict):
            if not val:
                return "N/A"
            return " | ".join(f"{k}: {v}" for k, v in val.items())
        if isinstance(val, str):
            try:
                parsed = json.loads(val)
                if isinstance(parsed, dict):
                    if not parsed:
                        return "N/A"
                    return " | ".join(f"{k}: {v}" for k, v in parsed.items())
                if isinstance(parsed, list):
                    return ", ".join(str(x) for x in parsed) if parsed else "N/A"
            except Exception:
                return str(val)
        if isinstance(val, list):
            return ", ".join(str(x) for x in val) if val else "N/A"
        return str(val)

    @staticmethod
    def _format_change_val(val: Any) -> str:
        if val is None or val == "":
            return "N/A"
        try:
            num = int(val)
            return f"+{num}" if num > 0 else str(num)
        except Exception:
            return str(val)

    @staticmethod
    def _format_state_dict(val: Any, format_cell_fn) -> str:
        if val is None or val == "":
            return "N/A"
        d = val
        if isinstance(val, str):
            try:
                d = json.loads(val)
            except Exception:
                return str(val)
        if not isinstance(d, dict):
            return str(val)

        formatted_pairs = []
        for k, v in d.items():
            if k in ("_id", "id", "v", "revision_id", "password_hash"):
                continue
            if v is None or v == "":
                continue

            if k in ("created_by", "updated_by", "deleted_by", "actor_id", "requested_by", "decided_by", "approved_by", "closed_by"):
                human_v = format_cell_fn("id_user", v, d)
            elif k in ("tank_id", "target_tank_id"):
                human_v = format_cell_fn("id_tank", v, d)
            elif k == "room_id":
                human_v = format_cell_fn("id_room", v, d)
            elif k == "facility_id":
                human_v = format_cell_fn("id_facility", v, d)
            elif k == "project_id":
                human_v = format_cell_fn("id_project", v, d)
            elif k == "species_id":
                human_v = format_cell_fn("id_species", v, d)
            elif k == "facility_ids":
                human_v = format_cell_fn("id_facility_list", v, d)
            elif k == "room_ids":
                human_v = format_cell_fn("id_room_list", v, d)
            elif k == "assigned_tank_ids":
                human_v = format_cell_fn("id_tank_list", v, d)
            elif isinstance(v, bool):
                human_v = "Yes" if v else "No"
            elif isinstance(v, (datetime, date)):
                human_v = ExportService._format_date_val(v, include_time=True)
            elif isinstance(v, str):
                v_clean = v.replace("RoleEnum.", "").replace("StatusEnum.", "")
                if HEX_OBJECT_ID_REGEX.match(v_clean):
                    continue
                human_v = v_clean
            else:
                human_v = str(v)

            if human_v and human_v != "N/A" and not HEX_OBJECT_ID_REGEX.match(human_v):
                pretty_k = k.replace("_", " ").title()
                formatted_pairs.append(f"{pretty_k}: {human_v}")

        return " | ".join(formatted_pairs) if formatted_pairs else "N/A"

    @staticmethod
    def _format_action_human(action: str, row: dict) -> str:
        if not action:
            return "N/A"
        if action in _ACTION_HUMAN_MAP:
            return _ACTION_HUMAN_MAP[action]

        e_type = row.get("entity_type", "").replace("_", " ").title()
        if action == "create":
            return f"Created {e_type}" if e_type else "Created Entity"
        if action == "update":
            return f"Updated {e_type}" if e_type else "Updated Entity"
        if action == "delete":
            return f"Deleted {e_type}" if e_type else "Deleted Entity"

        return action.replace("_", " ").title()

    @staticmethod
    def _write_collection_sheet(zf: zipfile.ZipFile, name: str, rows: List[dict], format_cell_fn) -> None:
        schema = COLLECTION_SCHEMAS.get(name)
        buf = StringIO()
        writer = csv.writer(buf)

        if schema:
            headers = [header for _, header, _ in schema]
            writer.writerow(headers)
            for row in rows:
                line = []
                for field_key, _, fmt_type in schema:
                    raw_val = row.get(field_key)
                    line.append(format_cell_fn(fmt_type, raw_val, row))
                writer.writerow(line)
        else:
            if not rows:
                headers = list(COLLECTIONS[name]["model"].model_fields.keys())
            else:
                headers = list(rows[0].keys())
            headers = [h for h in headers if h not in ("id", "_id", "v", "revision_id", "password_hash")]
            writer.writerow([h.replace("_", " ").title() for h in headers])
            for row in rows:
                line = []
                for h in headers:
                    val = row.get(h)
                    if isinstance(val, bool):
                        line.append(ExportService._format_boolean_val(val))
                    elif isinstance(val, (datetime, date)):
                        line.append(ExportService._format_date_val(val))
                    elif isinstance(val, dict):
                        line.append(ExportService._format_json_dict_val(val))
                    elif val is None:
                        line.append("N/A")
                    else:
                        line.append(str(val))
                writer.writerow(line)

        zf.writestr(f"{name}.csv", buf.getvalue())

    @staticmethod
    def _write_water_quality_sheet(zf: zipfile.ZipFile, rows: List[dict], format_cell_fn) -> None:
        buf = StringIO()
        writer = csv.writer(buf)
        headers = [
            "Date", "Tank Number", "Project Title", "pH",
            "Temperature (°C)", "Dissolved Oxygen (mg/L)",
            "Comments", "Logged At", "Logged By",
        ]
        writer.writerow(headers)

        for row in rows:
            params = row.get("parameters") or {}
            ph = params.get("ph", params.get("pH", "N/A"))
            temp = params.get("temp_c", params.get("temperature", params.get("temp", "N/A")))
            do = params.get("do_mg_l", params.get("dissolved_oxygen", params.get("do", "N/A")))

            writer.writerow([
                ExportService._format_date_val(row.get("date"), include_time=False),
                format_cell_fn("id_tank", row.get("tank_id"), row),
                format_cell_fn("id_project", row.get("project_id"), row),
                str(ph) if ph is not None else "N/A",
                str(temp) if temp is not None else "N/A",
                str(do) if do is not None else "N/A",
                row.get("comments") or "N/A",
                ExportService._format_date_val(row.get("created_at"), include_time=True),
                format_cell_fn("id_user", row.get("created_by"), row),
            ])

        zf.writestr("water_quality.csv", buf.getvalue())

    @staticmethod
    def _write_test_strip_sheet(zf: zipfile.ZipFile, rows: List[dict], format_cell_fn) -> None:
        buf = StringIO()
        writer = csv.writer(buf)
        headers = [
            "Date", "Tank Number", "Project Title", "Nitrate (mg/L)",
            "Nitrite (mg/L)", "Hardness", "Chlorine (mg/L)", "Alkalinity",
            "pH", "Ammonia (mg/L)", "Comments", "Logged At", "Logged By",
        ]
        writer.writerow(headers)

        for row in rows:
            params = row.get("parameters") or {}
            nitrate = params.get("nitrate", params.get("nitrate_mg_l", "N/A"))
            nitrite = params.get("nitrite", params.get("nitrite_mg_l", "N/A"))
            hardness = params.get("hardness", "N/A")
            chlorine = params.get("chlorine", "N/A")
            alkalinity = params.get("alkalinity", "N/A")
            ph = params.get("ph", params.get("pH", "N/A"))
            ammonia = params.get("ammonia", params.get("ammonia_mg_l", "N/A"))

            writer.writerow([
                ExportService._format_date_val(row.get("date"), include_time=False),
                format_cell_fn("id_tank", row.get("tank_id"), row),
                format_cell_fn("id_project", row.get("project_id"), row),
                str(nitrate) if nitrate is not None else "N/A",
                str(nitrite) if nitrite is not None else "N/A",
                str(hardness) if hardness is not None else "N/A",
                str(chlorine) if chlorine is not None else "N/A",
                str(alkalinity) if alkalinity is not None else "N/A",
                str(ph) if ph is not None else "N/A",
                str(ammonia) if ammonia is not None else "N/A",
                row.get("comments") or "N/A",
                ExportService._format_date_val(row.get("created_at"), include_time=True),
                format_cell_fn("id_user", row.get("created_by"), row),
            ])

        zf.writestr("test_strip.csv", buf.getvalue())

    @staticmethod
    def _write_quarantine_sheet(zf: zipfile.ZipFile, bundle: Dict[str, List[dict]], format_cell_fn) -> int:
        buf = StringIO()
        writer = csv.writer(buf)
        headers = [
            "Event Type", "Date / Timestamp", "Source Tank", "Target Tank",
            "Project Title", "Fish Count", "Reason / Notes", "Urgency",
            "Status", "Initiated By", "Decided / Approved By",
        ]
        writer.writerow(headers)

        rows_written = 0

        # 1. Quarantine exemptions
        for q in bundle.get("quarantine_exemptions", []):
            st = q.get("status", "pending")
            evt_type = f"Exemption Request ({st.capitalize()})"
            writer.writerow([
                evt_type,
                ExportService._format_date_val(q.get("requested_at") or q.get("created_at"), include_time=True),
                format_cell_fn("id_tank", q.get("tank_id"), q),
                format_cell_fn("id_tank", q.get("target_tank_id"), q),
                format_cell_fn("id_project", q.get("project_id"), q),
                str(q.get("fish_count", "N/A")),
                q.get("reason") or "N/A",
                q.get("urgency") or "normal",
                st,
                format_cell_fn("id_user", q.get("requested_by") or q.get("created_by"), q),
                format_cell_fn("id_user", q.get("decided_by"), q),
            ])
            rows_written += 1

        # 2. Census quarantine events
        for c in bundle.get("census_events", []):
            e_type = c.get("event_type")
            if e_type in ("quarantine_placed", "quarantine_lifted"):
                evt_label = "Placed in Quarantine" if e_type == "quarantine_placed" else "Lifted Quarantine"
                writer.writerow([
                    evt_label,
                    ExportService._format_date_val(c.get("date") or c.get("created_at"), include_time=False),
                    format_cell_fn("id_tank", c.get("tank_id"), c),
                    "N/A",
                    format_cell_fn("id_project", c.get("project_id"), c),
                    ExportService._format_change_val(c.get("change")),
                    c.get("reason") or c.get("notes") or "N/A",
                    "normal",
                    "completed",
                    format_cell_fn("id_user", c.get("created_by"), c),
                    "N/A",
                ])
                rows_written += 1

        # 3. Audit log quarantine actions
        for a in bundle.get("audit_logs", []):
            act = a.get("action")
            if act in ("placed_in_quarantine", "lifted_quarantine"):
                evt_label = "Placed in Quarantine" if act == "placed_in_quarantine" else "Lifted Quarantine"
                writer.writerow([
                    evt_label,
                    ExportService._format_date_val(a.get("created_at"), include_time=True),
                    format_cell_fn("id_tank", a.get("entity_id"), a),
                    "N/A",
                    "N/A",
                    "N/A",
                    f"Tank action: {act.replace('_', ' ')}",
                    "normal",
                    "completed",
                    format_cell_fn("id_user", a.get("actor_id"), a),
                    "N/A",
                ])
                rows_written += 1

        zf.writestr("quarantine.csv", buf.getvalue())
        return rows_written

    @staticmethod
    def _write_manifest(zf: zipfile.ZipFile, meta: Dict[str, Any], record_counts: Dict[str, int]) -> None:
        buf = StringIO()
        writer = csv.writer(buf)
        writer.writerow(["ACARE Data Export Manifest"])
        writer.writerow(["Generated At (UTC)", ExportService._format_date_val(meta.get("generated_at"), include_time=True)])
        writer.writerow(["Exported By", meta.get("actor_name", "Unknown User")])
        writer.writerow(["Scope", meta.get("scope", "All Records")])
        writer.writerow([])
        writer.writerow(["Collection", "Record Count"])
        for collection_name, count in record_counts.items():
            pretty_name = collection_name.replace("_", " ").title()
            writer.writerow([pretty_name, count])
        zf.writestr("manifest.csv", buf.getvalue())

    @staticmethod
    def generate_csv_export(bundle: Dict[str, List[dict]], meta: Dict[str, Any]) -> BytesIO:
        """Human-readable export: one CSV per collection + quarantine sheet + manifest, zipped."""
        user_map = {}
        for u in bundle.get("users", []):
            name_str = f"{u.get('first_name', '')} {u.get('last_name', '')}".strip() or u.get("email", "Unknown User")
            if u.get("id"):
                user_map[str(u["id"])] = name_str
            if u.get("_id"):
                user_map[str(u["_id"])] = name_str

        tank_map = {}
        for t in bundle.get("tanks", []):
            t_str = f"Tank {t.get('tank_number')}"
            if t.get("id"):
                tank_map[str(t["id"])] = t_str
            if t.get("_id"):
                tank_map[str(t["_id"])] = t_str

        facility_map = {}
        for f in bundle.get("facilities", []):
            f_str = f.get("name", "Unknown Facility")
            if f.get("id"):
                facility_map[str(f["id"])] = f_str
            if f.get("_id"):
                facility_map[str(f["_id"])] = f_str

        room_map = {}
        for r in bundle.get("rooms", []):
            fac_name = facility_map.get(str(r.get("facility_id")), "")
            r_str = f"Room {r.get('room_number')}" + (f" ({fac_name})" if fac_name else "")
            if r.get("id"):
                room_map[str(r["id"])] = r_str
            if r.get("_id"):
                room_map[str(r["_id"])] = r_str

        project_map = {}
        for p in bundle.get("projects", []):
            p_str = p.get("title", "Unknown Project")
            if p.get("id"):
                project_map[str(p["id"])] = p_str
            if p.get("_id"):
                project_map[str(p["_id"])] = p_str

        species_map = {}
        for s in bundle.get("species", []):
            s_str = s.get("name", "Unknown Species")
            if s.get("id"):
                species_map[str(s["id"])] = s_str
            if s.get("_id"):
                species_map[str(s["_id"])] = s_str

        tank_assignment_map = {}
        for ta in bundle.get("tank_assignments", []):
            t_lbl = tank_map.get(str(ta.get("tank_id")), "Unknown Tank")
            p_lbl = project_map.get(str(ta.get("project_id")), "Unknown Project")
            ta_str = f"{t_lbl} / {p_lbl}"
            if ta.get("id"):
                tank_assignment_map[str(ta["id"])] = ta_str
            if ta.get("_id"):
                tank_assignment_map[str(ta["_id"])] = ta_str

        water_quality_log_map = {}
        for w in bundle.get("water_quality_logs", []):
            w_str = f"Water Quality Log ({ExportService._format_date_val(w.get('date'), include_time=False)})"
            if w.get("id"):
                water_quality_log_map[str(w["id"])] = w_str
            if w.get("_id"):
                water_quality_log_map[str(w["_id"])] = w_str

        incident_report_map = {}
        for i in bundle.get("incident_reports", []):
            i_str = f"Incident Report ({i.get('problem', 'Incident')})"
            if i.get("id"):
                incident_report_map[str(i["id"])] = i_str
            if i.get("_id"):
                incident_report_map[str(i["_id"])] = i_str

        quarantine_exemption_map = {}
        for q in bundle.get("quarantine_exemptions", []):
            q_str = f"Quarantine Exemption ({q.get('reason', 'Exemption')})"
            if q.get("id"):
                quarantine_exemption_map[str(q["id"])] = q_str
            if q.get("_id"):
                quarantine_exemption_map[str(q["_id"])] = q_str

        census_event_map = {}
        for c in bundle.get("census_events", []):
            c_str = f"Census Event ({c.get('event_type', 'Event')})"
            if c.get("id"):
                census_event_map[str(c["id"])] = c_str
            if c.get("_id"):
                census_event_map[str(c["_id"])] = c_str

        individual_fish_map = {}
        for f_item in bundle.get("individual_fish", []):
            f_str = f"Fish Tag {f_item.get('fish_id', 'Unknown')}"
            if f_item.get("id"):
                individual_fish_map[str(f_item["id"])] = f_str
            if f_item.get("_id"):
                individual_fish_map[str(f_item["_id"])] = f_str

        entity_label_maps = {
            "user": user_map,
            "tank": tank_map,
            "room": room_map,
            "facility": facility_map,
            "project": project_map,
            "tank_assignment": tank_assignment_map,
            "species": species_map,
            "water_quality_log": water_quality_log_map,
            "incident_report": incident_report_map,
            "quarantine_exemption": quarantine_exemption_map,
            "census_event": census_event_map,
            "individual_fish": individual_fish_map,
        }

        def format_cell_fn(fmt_type: str, val: Any, row: dict) -> str:
            if fmt_type == "text":
                if val is None or val == "":
                    return "N/A"
                val_str = str(val).replace("RoleEnum.", "").replace("StatusEnum.", "")
                return val_str
            elif fmt_type == "id_user":
                return user_map.get(str(val), "N/A") if val else "N/A"
            elif fmt_type == "id_tank":
                return tank_map.get(str(val), "N/A") if val else "N/A"
            elif fmt_type == "id_room":
                return room_map.get(str(val), "N/A") if val else "N/A"
            elif fmt_type == "id_facility":
                return facility_map.get(str(val), "N/A") if val else "N/A"
            elif fmt_type == "id_project":
                return project_map.get(str(val), "N/A") if val else "N/A"
            elif fmt_type == "id_species":
                return species_map.get(str(val), "N/A") if val else "N/A"
            elif fmt_type == "id_tank_assignment":
                return tank_assignment_map.get(str(val), "N/A") if val else "N/A"
            elif fmt_type == "id_user_list":
                if isinstance(val, list) and val:
                    return "; ".join(user_map.get(str(v), "Unknown User") for v in val)
                return "N/A"
            elif fmt_type == "id_tank_list":
                if isinstance(val, list) and val:
                    return "; ".join(tank_map.get(str(v), "Unknown Tank") for v in val)
                return "N/A"
            elif fmt_type == "id_room_list":
                if isinstance(val, list) and val:
                    return "; ".join(room_map.get(str(v), "Unknown Room") for v in val)
                return "N/A"
            elif fmt_type == "id_facility_list":
                if isinstance(val, list) and val:
                    return "; ".join(facility_map.get(str(v), "Unknown Facility") for v in val)
                return "N/A"
            elif fmt_type == "id_polymorphic":
                if not val:
                    return "N/A"
                e_type = row.get("entity_type")
                l_map = entity_label_maps.get(e_type)
                if l_map and str(val) in l_map:
                    return l_map[str(val)]
                if HEX_OBJECT_ID_REGEX.match(str(val)):
                    return f"{e_type.replace('_', ' ').title() if e_type else 'Entity'}"
                return str(val)
            elif fmt_type == "datetime":
                return ExportService._format_date_val(val, include_time=True)
            elif fmt_type == "date_only":
                return ExportService._format_date_val(val, include_time=False)
            elif fmt_type == "boolean":
                return ExportService._format_boolean_val(val)
            elif fmt_type == "json_dict":
                return ExportService._format_json_dict_val(val)
            elif fmt_type == "state_diff":
                return ExportService._format_state_dict(val, format_cell_fn)
            elif fmt_type == "action_human":
                return ExportService._format_action_human(str(val), row)
            elif fmt_type == "count_change":
                return ExportService._format_change_val(val)
            
            clean_str = str(val).replace("RoleEnum.", "").replace("StatusEnum.", "") if val is not None else "N/A"
            return clean_str

        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            record_counts = {}

            for name, rows in bundle.items():
                if name == "water_quality_logs":
                    daily_rows = [r for r in rows if r.get("type") != "test_strip"]
                    test_strip_rows = [r for r in rows if r.get("type") == "test_strip"]
                    ExportService._write_water_quality_sheet(zf, daily_rows, format_cell_fn)
                    ExportService._write_test_strip_sheet(zf, test_strip_rows, format_cell_fn)
                    record_counts["water_quality"] = len(daily_rows)
                    record_counts["test_strip"] = len(test_strip_rows)
                else:
                    ExportService._write_collection_sheet(zf, name, rows, format_cell_fn)
                    record_counts[name] = len(rows)

            q_count = ExportService._write_quarantine_sheet(zf, bundle, format_cell_fn)
            record_counts["quarantine"] = q_count

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
            entity_type="user",
            entity_id=str(actor.id),
            after={
                "format": export_format,
                "start_date": start_date.isoformat() if start_date else None,
                "end_date": end_date.isoformat() if end_date else None,
                "record_counts": record_counts,
            },
        ))
