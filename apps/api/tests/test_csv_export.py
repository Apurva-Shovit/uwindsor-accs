import csv
import io
import re
import zipfile
from datetime import datetime, date, timezone
import pytest

from app.services.export_service import ExportService, COLLECTIONS, COLLECTION_SCHEMAS

def test_collection_schemas_cover_all_collections():
    """Verify every collection in COLLECTIONS (except split water_quality_logs) has a corresponding human-readable schema."""
    for name in COLLECTIONS:
        if name == "water_quality_logs":
            continue
        assert name in COLLECTION_SCHEMAS, f"Collection {name} missing from COLLECTION_SCHEMAS"

def test_generate_csv_export_formatting_and_entity_resolution():
    """Test full zip export bundle generation, verifying human-readability and zero raw ObjectId leakage."""

    dummy_user_id = "65fa11112222333344445555"
    dummy_tank_id = "65fa66667777888899990000"
    dummy_room_id = "65fa77778888999900001111"
    dummy_fac_id = "65fa88889999000011112222"
    dummy_proj_id = "65fa99990000111122223333"
    dummy_ta_id = "65faaaaaaaaaaaaaaaaaaaaa"
    dummy_wq_id = "65faeeeeeeeeeeeeeeeeeeee"
    dummy_inc_id = "65faffffffffffffffffffff"
    dummy_ex_id = "65fa12121212121212121212"

    bundle = {
        "users": [{
            "id": dummy_user_id,
            "first_name": "Jane",
            "last_name": "Smith",
            "email": "jane.smith@uwindsor.ca",
            "role": "RoleEnum.chair",
            "requested_role": "RoleEnum.chair",
            "status": "StatusEnum.active",
            "facility_ids": [dummy_fac_id],
            "room_ids": [dummy_room_id],
            "assigned_tank_ids": [dummy_tank_id],
            "approved_by": dummy_user_id,
            "approved_at": "2026-08-01T14:30:00+00:00",
            "rejection_reason": None,
            "created_at": "2026-07-20T10:15:30+00:00",
            "created_by": dummy_user_id,
            "updated_at": "2026-08-01T14:30:00+00:00",
            "updated_by": dummy_user_id,
            "deleted": False,
            "deleted_at": None,
            "deleted_by": None,
        }],
        "facilities": [{
            "id": dummy_fac_id,
            "name": "Main Aquatic Facility",
            "address": "401 Sunset Ave",
            "description": "Primary research facility",
            "active": True,
            "created_at": "2026-01-10T09:00:00+00:00",
            "created_by": dummy_user_id,
            "updated_at": "2026-01-10T09:00:00+00:00",
            "updated_by": None,
            "deleted": False,
            "deleted_at": None,
            "deleted_by": None,
        }],
        "rooms": [{
            "id": dummy_room_id,
            "facility_id": dummy_fac_id,
            "room_number": "101",
            "description": "Cold water room",
            "active": True,
            "created_at": "2026-01-11T10:00:00+00:00",
            "created_by": dummy_user_id,
            "updated_at": "2026-01-11T10:00:00+00:00",
            "updated_by": None,
            "deleted": False,
            "deleted_at": None,
            "deleted_by": None,
        }],
        "tanks": [{
            "id": dummy_tank_id,
            "room_id": dummy_room_id,
            "tank_number": "T-101",
            "status": "active",
            "is_quarantined": False,
            "quarantine_start_date": None,
            "quarantine_end_date": None,
            "notes": "Recirculating rack",
            "created_at": "2026-01-12T11:00:00+00:00",
            "created_by": dummy_user_id,
            "updated_at": "2026-01-12T11:00:00+00:00",
            "updated_by": None,
            "deleted": False,
            "deleted_at": None,
            "deleted_by": None,
        }],
        "species": [{
            "id": "65fabbbbbbbbbbbbbbbbbbbb",
            "name": "Salvelinus namaycush (Lake Trout)",
            "created_at": "2026-01-05T08:00:00+00:00",
            "created_by": dummy_user_id,
        }],
        "projects": [{
            "id": dummy_proj_id,
            "title": "Great Lakes Trout Thermal Adaptation",
            "pi_name": "Dr. Jane Smith",
            "aupp_number": "AUPP-2026-04",
            "status": "active",
            "rfid_tracking_enabled": True,
            "species": "Salvelinus namaycush",
            "sex": "both",
            "dob": "2025-11-15T00:00:00",
            "established_date": "2026-02-01T00:00:00",
            "source": "Hatchery",
            "aupp_expiry_date": "2027-02-01T00:00:00",
            "room_number": "101",
            "closed_at": None,
            "closed_by": None,
            "disposition_type": None,
            "disposition_notes": None,
            "created_at": "2026-02-01T09:30:00+00:00",
            "created_by": dummy_user_id,
        }],
        "tank_assignments": [{
            "id": dummy_ta_id,
            "project_id": dummy_proj_id,
            "tank_id": dummy_tank_id,
            "current_count": 45,
            "pi_name": "Dr. Jane Smith",
            "aupp_number": "AUPP-2026-04",
            "created_at": "2026-02-02T10:00:00+00:00",
            "created_by": dummy_user_id,
        }],
        "individual_fish": [{
            "id": "65facccccccccccccccccccc",
            "fish_id": "FISH-0042",
            "rfid_tag": "982000123456789",
            "species": "Lake Trout",
            "tank_id": dummy_tank_id,
            "project_id": dummy_proj_id,
            "dob": "2025-11-15T00:00:00",
            "sex": "male",
            "status": "healthy",
            "notes": "Intake tag",
            "created_at": "2026-02-05T14:00:00+00:00",
            "created_by": dummy_user_id,
            "updated_at": "2026-02-05T14:00:00+00:00",
            "updated_by": None,
            "deleted": False,
            "deleted_at": None,
            "deleted_by": None,
        }],
        "census_events": [{
            "id": "65fadddddddddddddddddddd",
            "date": "2026-08-01",
            "project_id": dummy_proj_id,
            "tank_id": dummy_tank_id,
            "event_type": "quarantine_placed",
            "change": 20,
            "reason": "Shipment quarantine",
            "notes": "Quarantine entry",
            "transfer_group_id": None,
            "created_at": "2026-08-01T11:20:00+00:00",
            "created_by": dummy_user_id,
        }],
        "water_quality_logs": [
            {
                "id": dummy_wq_id,
                "date": "2026-08-10",
                "tank_id": dummy_tank_id,
                "project_id": dummy_proj_id,
                "type": "daily",
                "parameters": {"temp_c": 12.5, "ph": 7.4, "do_mg_l": 9.2},
                "comments": "Normal daily",
                "created_at": "2026-08-10T08:30:00+00:00",
                "created_by": dummy_user_id,
            },
            {
                "id": "65faeeeeeeeeeeeeeeeeeee2",
                "date": "2026-08-11",
                "tank_id": dummy_tank_id,
                "project_id": dummy_proj_id,
                "type": "test_strip",
                "parameters": {
                    "nitrate": 20.0,
                    "nitrite": 0.0,
                    "hardness": 150,
                    "chlorine": 0.0,
                    "alkalinity": 120,
                    "ph": 7.4,
                    "ammonia": 0.0,
                },
                "comments": "Weekly test strip",
                "created_at": "2026-08-11T08:45:00+00:00",
                "created_by": dummy_user_id,
            }
        ],
        "incident_reports": [{
            "id": dummy_inc_id,
            "date": "2026-08-05",
            "tank_id": dummy_tank_id,
            "project_id": dummy_proj_id,
            "problem": "Filter clog",
            "treatment": "Cleaned filter",
            "comments": "Restored",
            "aquatic_condition_checked": True,
            "vet_contacted": False,
            "researcher_notified": True,
            "created_at": "2026-08-05T13:15:00+00:00",
            "created_by": dummy_user_id,
        }],
        "quarantine_exemptions": [{
            "id": dummy_ex_id,
            "tank_id": dummy_tank_id,
            "target_tank_id": dummy_tank_id,
            "project_id": dummy_proj_id,
            "fish_count": 10,
            "reason": "Vet Clearance",
            "urgency": "normal",
            "status": "approved",
            "requested_by": dummy_user_id,
            "requested_at": "2026-08-02T10:00:00+00:00",
            "decided_by": dummy_user_id,
            "decided_at": "2026-08-02T16:00:00+00:00",
            "rejection_reason": None,
            "created_at": "2026-08-02T10:00:00+00:00",
            "created_by": dummy_user_id,
            "updated_at": "2026-08-02T16:00:00+00:00",
            "updated_by": dummy_user_id,
            "deleted": False,
            "deleted_at": None,
            "deleted_by": None,
        }],
        "audit_logs": [
            {
                "id": "65fa34343434343434343434",
                "actor_id": dummy_user_id,
                "actor_role": "chair",
                "action": "user_approve",
                "entity_type": "user",
                "entity_id": dummy_user_id,
                "before": {"status": "RoleEnum.pending", "created_by": dummy_user_id},
                "after": {"status": "RoleEnum.chair", "approved_by": dummy_user_id},
                "created_at": "2026-08-01T14:30:00+00:00",
                "created_by": dummy_user_id,
                "updated_at": "2026-08-01T14:30:00+00:00",
                "updated_by": None,
                "deleted": False,
                "deleted_at": None,
                "deleted_by": None,
            },
            {
                "id": "65fa34343434343434343435",
                "actor_id": dummy_user_id,
                "actor_role": "chair",
                "action": "create",
                "entity_type": "project",
                "entity_id": dummy_proj_id,
                "before": None,
                "after": {"title": "Great Lakes Trout Thermal Adaptation", "created_by": dummy_user_id},
                "created_at": "2026-08-01T14:35:00+00:00",
            },
            {
                "id": "65fa34343434343434343436",
                "actor_id": dummy_user_id,
                "actor_role": "chair",
                "action": "create",
                "entity_type": "water_quality_log",
                "entity_id": dummy_wq_id,
                "before": None,
                "after": {"tank_id": dummy_tank_id, "type": "daily"},
                "created_at": "2026-08-10T08:30:00+00:00",
            }
        ],
    }

    meta = {
        "generated_at": "2026-08-11T10:20:00+00:00",
        "actor_name": "Jane Smith",
        "scope": "All Records",
    }

    zip_bytes = ExportService.generate_csv_export(bundle, meta)
    assert zip_bytes is not None

    with zipfile.ZipFile(zip_bytes, "r") as zf:
        file_list = zf.namelist()
        expected_files = [
            "users.csv", "facilities.csv", "rooms.csv", "tanks.csv", "species.csv",
            "projects.csv", "tank_assignments.csv", "individual_fish.csv",
            "census_events.csv", "water_quality.csv", "test_strip.csv",
            "incident_reports.csv", "quarantine_exemptions.csv", "audit_logs.csv",
            "quarantine.csv", "manifest.csv"
        ]
        for expected in expected_files:
            assert expected in file_list, f"Missing {expected} in export zip"

        object_id_regex = re.compile(r"^[0-9a-fA-F]{24}$")

        for filename in file_list:
            content = zf.read(filename).decode("utf-8")
            reader = csv.reader(io.StringIO(content))
            rows = list(reader)
            assert len(rows) >= 1, f"{filename} is empty"

            headers = rows[0]
            for forbidden_header in ["id", "_id", "v", "revision_id"]:
                assert forbidden_header not in headers, f"Forbidden ID header '{forbidden_header}' found in {filename}"

            for row_idx, row in enumerate(rows[1:], start=2):
                for col_idx, cell in enumerate(row):
                    header = headers[col_idx] if col_idx < len(headers) else f"col_{col_idx}"
                    assert not object_id_regex.match(cell), (
                        f"Raw ObjectId leakage found in {filename} line {row_idx}, column '{header}': '{cell}'"
                    )

        # 1. Test users.csv enum stripping
        users_csv = zf.read("users.csv").decode("utf-8")
        assert "RoleEnum." not in users_csv
        assert "StatusEnum." not in users_csv
        assert "chair" in users_csv
        assert "active" in users_csv

        # 2. Test water_quality.csv
        wq_csv = zf.read("water_quality.csv").decode("utf-8")
        wq_reader = list(csv.reader(io.StringIO(wq_csv)))
        assert wq_reader[0] == [
            "Date", "Tank Number", "Project Title", "pH",
            "Temperature (°C)", "Dissolved Oxygen (mg/L)",
            "Comments", "Logged At", "Logged By"
        ]
        assert "7.4" in wq_csv
        assert "12.5" in wq_csv
        assert "9.2" in wq_csv

        # 3. Test test_strip.csv
        ts_csv = zf.read("test_strip.csv").decode("utf-8")
        ts_reader = list(csv.reader(io.StringIO(ts_csv)))
        assert ts_reader[0] == [
            "Date", "Tank Number", "Project Title", "Nitrate (mg/L)",
            "Nitrite (mg/L)", "Hardness", "Chlorine (mg/L)", "Alkalinity",
            "pH", "Ammonia (mg/L)", "Comments", "Logged At", "Logged By"
        ]
        assert "150" in ts_csv

        # 4. Test quarantine.csv
        q_csv = zf.read("quarantine.csv").decode("utf-8")
        assert "Exemption Request (Approved)" in q_csv
        assert "Placed in Quarantine" in q_csv
        assert "Vet Clearance" in q_csv

        # 5. Test audit_logs.csv action human phrases and zero ObjectId leakage
        audit_csv = zf.read("audit_logs.csv").decode("utf-8")
        audit_reader = list(csv.reader(io.StringIO(audit_csv)))
        audit_headers = audit_reader[0]
        assert "Created By" not in audit_headers
        assert "Updated By" not in audit_headers
        assert "Approved User Account" in audit_csv
        assert "Created Project" in audit_csv
        assert "Water Quality Log" in audit_csv
        assert "Jane Smith" in audit_csv
