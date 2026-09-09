import pytest
from datetime import date
from app.db import init_db
from app.models.incident_report import IncidentReport
from app.models.user import User, RoleEnum
from app.models.facility import Tank, Room, Facility
from app.schemas.incident_report import IncidentReportCreate
from app.services.incident_report_service import IncidentReportService

@pytest.mark.asyncio
async def test_incident_report_time_field():
    await init_db()

    fac = Facility(name="Test Fac Time", active=True)
    await fac.insert()
    room = Room(facility_id=str(fac.id), room_number="R102", active=True)
    await room.insert()
    tank = Tank(room_id=str(room.id), tank_number="881", status="active", is_quarantined=False)
    await tank.insert()
    tank_id = str(tank.id)

    import uuid
    unique_email = f"staff_{uuid.uuid4()}@uwindsor.ca"
    user = User(
        first_name="Staff",
        last_name="Test",
        email=unique_email,
        password_hash="fake",
        role=RoleEnum.manager,
        requested_role=RoleEnum.manager,
        assigned_tank_ids=[tank_id],
    )
    await user.insert()

    body = IncidentReportCreate(
        tank_id=tank_id,
        date=date(2026, 9, 9),
        time="14:30",
        problem="Test incident with 24hr time field",
        vet_contacted=False,
    )

    res = await IncidentReportService.create_report(body, user)
    assert res["time"] == "14:30"
    assert res["problem"] == "Test incident with 24hr time field"

    fetched = await IncidentReport.get(res["_id"] if "_id" in res else res["id"])
    assert fetched is not None
    assert fetched.time == "14:30"

