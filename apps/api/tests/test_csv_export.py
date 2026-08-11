import csv
import io
import re
import zipfile
from datetime import datetime, date, timezone
import pytest

from app.services.export_service import ExportService, COLLECTIONS, COLLECTION_SCHEMAS

def test_collection_schemas_cover_all_collections():
    """Verify every collection in COLLECTIONS has a corresponding human-readable schema."""
    for name in COLLECTIONS:
        assert name in COLLECTION_SCHEMAS, f"Collection {name} missing from COLLECTION_SCHEMAS"

def test_generate_csv_export_formatting_and_entity_resolution():
    """Test full zip export bundle generation, verifying human-readability and zero raw ObjectId leakage."""

    dummy_user_id = "65fa11112222333344445555"
    dummy_tank_id = "65fa66667777888899990000"
    dummy_room_id = "65fa77778888999900001111"
    dummy_fac_id = "65fa88889999000011112222"
    dummy_proj_id = "65fa99990000111122223333"
    dummy_ta_id = "65faaaaaaaaaaaaaaaaaaaaa"

    bundle = {
        "users": [{
            "id": dummy_user_id,
            "first_name": "Jane",
            "last_name": "Smith",
            "email": "jane.smith@uwindsor.ca",
            "role": "chair",
            "requested_role": "chair",
            "status": "active",
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
            "event_type": "arrival",
            "change": 20,
            "reason": "Shipment",
            "notes": "Healthy arrival",
            "transfer_group_id": None,
            "created_at": "2026-08-01T11:20:00+00:00",
            "created_by": dummy_user_id,
        }],
        "water_quality_logs": [{
            "id": "65faeeeeeeeeeeeeeeeeeeee",
            "date": "2026-08-10",
            "tank_id": dummy_tank_id,
            "project_id": dummy_proj_id,
            "type": "daily",
            "parameters": {"temp_c": 12.5, "ph": 7.4, "do_mg_l": 9.2},
            "comments": "Normal",
            "created_at": "2026-08-10T08:30:00+00:00",
            "created_by": dummy_user_id,
        }],
        "incident_reports": [{
            "id": "65faffffffffffffffffffff",
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
            "id": "65fa12121212121212121212",
            "tank_id": dummy_tank_id,
            "target_tank_id": dummy_tank_id,
            "project_id": dummy_proj_id,
            "fish_count": 10,
            "reason": "Clearance",
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
        "audit_logs": [{
            "id": "65fa34343434343434343434",
            "actor_id": dummy_user_id,
            "actor_role": "chair",
            "action": "user_approve",
            "entity_type": "user",
            "entity_id": dummy_user_id,
            "before": {"status": "pending"},
            "after": {"status": "active"},
            "created_at": "2026-08-01T14:30:00+00:00",
            "created_by": dummy_user_id,
            "updated_at": "2026-08-01T14:30:00+00:00",
            "updated_by": None,
            "deleted": False,
            "deleted_at": None,
            "deleted_by": None,
        }],
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
        expected_files = [f"{col}.csv" for col in COLLECTIONS.keys()] + ["manifest.csv"]
        for expected in expected_files:
            assert expected in file_list, f"Missing {expected} in export zip"

        # Regex for matching raw 24-char hex ObjectIDs
        object_id_regex = re.compile(r"^[0-9a-fA-F]{24}$")

        for filename in file_list:
            content = zf.read(filename).decode("utf-8")
            reader = csv.reader(io.StringIO(content))
            rows = list(reader)
            assert len(rows) >= 1, f"{filename} is empty"

            headers = rows[0]
            # Ensure no header is 'id', '_id', 'v', 'revision_id'
            for forbidden_header in ["id", "_id", "v", "revision_id"]:
                assert forbidden_header not in headers, f"Forbidden ID header '{forbidden_header}' found in {filename}"

            for row_idx, row in enumerate(rows[1:], start=2):
                for col_idx, cell in enumerate(row):
                    header = headers[col_idx] if col_idx < len(headers) else f"col_{col_idx}"
                    # Make sure raw 24-character hexadecimal ObjectId strings are not present in cells
                    assert not object_id_regex.match(cell), (
                        f"Raw ObjectId leakage found in {filename} line {row_idx}, column '{header}': '{cell}'"
                    )

        # Detailed assertions on users.csv
        users_csv = zf.read("users.csv").decode("utf-8")
        assert "Jane Smith" in users_csv
        assert "Main Aquatic Facility" in users_csv
        assert "Room 101" in users_csv
        assert "Tank T-101" in users_csv

        # Detailed assertions on water_quality_logs.csv
        wq_csv = zf.read("water_quality_logs.csv").decode("utf-8")
        assert "temp_c: 12.5 | ph: 7.4 | do_mg_l: 9.2" in wq_csv
        assert "Tank T-101" in wq_csv
        assert "Great Lakes Trout Thermal Adaptation" in wq_csv

        # Detailed assertions on incident_reports.csv
        incident_csv = zf.read("incident_reports.csv").decode("utf-8")
        assert "Aquatic Condition Checked" in incident_csv[0:200]
        assert "Yes" in incident_csv
        assert "No" in incident_csv

        # Detailed assertions on manifest.csv
        manifest_csv = zf.read("manifest.csv").decode("utf-8")
        assert "ACARE Data Export Manifest" in manifest_csv
        assert "Water Quality Logs" in manifest_csv
        assert "Jane Smith" in manifest_csv
