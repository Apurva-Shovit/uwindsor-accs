import pytest
from datetime import datetime, timezone
from app.db import init_db
from app.models.facility import Tank, Room, Facility
from app.models.incident_report import IncidentReport
from app.models.census_event import CensusEvent
from app.services.dashboard_service import DashboardService

@pytest.mark.asyncio
async def test_dashboard_attention_count_incidents_and_deaths():
    await init_db()

    # Create dummy facility, room, tank
    fac = Facility(name="Test Fac Attention", active=True)
    await fac.insert()

    room = Room(facility_id=str(fac.id), room_number="R101", active=True)
    await room.insert()

    # tank1: active, non-quarantined, incident
    tank1 = Tank(room_id=str(room.id), tank_number="991", status="active", is_quarantined=False)
    await tank1.insert()

    # tank2: active, non-quarantined, death
    tank2 = Tank(room_id=str(room.id), tank_number="992", status="active", is_quarantined=False)
    await tank2.insert()

    # tank3: active, quarantined AND incident (should increment BOTH quarantine and attention)
    tank3 = Tank(room_id=str(room.id), tank_number="993", status="active", is_quarantined=True)
    await tank3.insert()

    now = datetime.now(timezone.utc)
    today = now.date()

    # Incident report for tank1 in last 24h
    inc1 = IncidentReport(
        tank_id=str(tank1.id),
        date=today,
        problem="Filter blockage",
        created_by="test@uwindsor.ca",
        created_at=now
    )
    await inc1.insert()

    # Death census event for tank2 in last 24h
    death2 = CensusEvent(
        project_id="p123",
        tank_assignment_id="ta123",
        tank_id=str(tank2.id),
        date=today,
        event_type="death",
        change=-1,
        created_by="test@uwindsor.ca",
        created_at=now
    )
    await death2.insert()

    # Incident report for quarantined tank3 in last 24h
    inc3 = IncidentReport(
        tank_id=str(tank3.id),
        date=today,
        problem="Water level low",
        created_by="test@uwindsor.ca",
        created_at=now
    )
    await inc3.insert()

    summary = await DashboardService.get_dashboard_summary()
    assert summary["tank_status"]["attention"] >= 3
    assert summary["tank_status"]["quarantine"] >= 1

    # Cleanup
    await inc1.delete()
    await death2.delete()
    await inc3.delete()
    await tank1.delete()
    await tank2.delete()
    await tank3.delete()
    await room.delete()
    await fac.delete()
