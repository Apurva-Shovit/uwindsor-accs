import asyncio

import pytest
from fastapi import HTTPException

from app.db import init_db
from app.models.audit_log import AuditLog
from app.models.census_event import CensusEvent
from app.models.facility import Facility, Room, Tank
from app.models.quarantine import QuarantineExemption
from app.models.tank_assignment import TankAssignment
from app.models.user import User, RoleEnum, StatusEnum
from app.services.quarantine_service import ExemptionDecision, QuarantineService

TEST_PROJECT_ID = "exemption-race-project"
TEST_EMAIL = "exemption.race@uwindsor.ca"


@pytest.fixture
async def fixture_data():
    await init_db()

    fac = Facility(name="Exemption Race Facility", active=True)
    await fac.insert()
    room = Room(facility_id=str(fac.id), room_number="R-EXR", active=True)
    await room.insert()

    source_tank = Tank(room_id=str(room.id), tank_number="8801", status="active", is_quarantined=True)
    await source_tank.insert()
    target_tank = Tank(room_id=str(room.id), tank_number="8802", status="active", is_quarantined=False)
    await target_tank.insert()

    source_ta = TankAssignment(
        project_id=TEST_PROJECT_ID,
        tank_id=str(source_tank.id),
        current_count=20,
        created_by="test",
    )
    await source_ta.insert()

    manager = User(
        email=TEST_EMAIL,
        password_hash="x",
        first_name="Race",
        last_name="Manager",
        requested_role=RoleEnum.manager,
        role=RoleEnum.manager,
        status=StatusEnum.active,
    )
    await manager.insert()

    yield {
        "source_tank": source_tank,
        "target_tank": target_tank,
        "source_ta": source_ta,
        "manager": manager,
        "room": room,
        "facility": fac,
    }

    await CensusEvent.find({"project_id": TEST_PROJECT_ID}).delete()
    await TankAssignment.find({"project_id": TEST_PROJECT_ID}).delete()
    await QuarantineExemption.find({"requested_by": str(manager.id)}).delete()
    await AuditLog.find({"actor_id": str(manager.id)}).delete()
    await Tank.find({"room_id": str(room.id)}).delete()
    await Room.find({"facility_id": str(fac.id)}).delete()
    await Facility.find({"name": "Exemption Race Facility"}).delete()
    await User.find({"email": TEST_EMAIL}).delete()


async def _make_exemption(data, fish_count: int = 5) -> QuarantineExemption:
    ex = QuarantineExemption(
        tank_id=str(data["source_tank"].id),
        target_tank_id=str(data["target_tank"].id),
        fish_count=fish_count,
        reason="Race test",
        requested_by=str(data["manager"].id),
    )
    await ex.insert()
    return ex


@pytest.mark.asyncio
async def test_concurrent_approvals_transfer_the_fish_once(fixture_data):
    """A double-clicked "Accept & Transfer" must move the fish a single time."""
    data = fixture_data
    ex = await _make_exemption(data, fish_count=5)

    results = await asyncio.gather(
        QuarantineService.decide_exemption(str(ex.id), ExemptionDecision(approved=True), data["manager"]),
        QuarantineService.decide_exemption(str(ex.id), ExemptionDecision(approved=True), data["manager"]),
        return_exceptions=True,
    )

    losers = [r for r in results if isinstance(r, HTTPException)]
    assert len(losers) == 1, f"expected one rejected duplicate, got {results}"
    assert losers[0].status_code == 409

    source_ta = await TankAssignment.get(data["source_ta"].id)
    assert source_ta.current_count == 15

    dest_ta = await TankAssignment.find_one({"tank_id": str(data["target_tank"].id)})
    assert dest_ta is not None
    assert dest_ta.current_count == 5

    transfers = await CensusEvent.find({
        "project_id": TEST_PROJECT_ID,
        "event_type": "transfer_out",
    }).to_list()
    assert len(transfers) == 1

    ex = await QuarantineExemption.get(ex.id)
    assert ex.status == "approved"
    assert ex.decided_by == str(data["manager"].id)


@pytest.mark.asyncio
async def test_deciding_an_already_processed_request_is_refused(fixture_data):
    data = fixture_data
    ex = await _make_exemption(data, fish_count=2)

    await QuarantineService.decide_exemption(str(ex.id), ExemptionDecision(approved=False), data["manager"])

    with pytest.raises(HTTPException) as err:
        await QuarantineService.decide_exemption(str(ex.id), ExemptionDecision(approved=True), data["manager"])
    assert err.value.status_code == 409

    source_ta = await TankAssignment.get(data["source_ta"].id)
    assert source_ta.current_count == 20


@pytest.mark.asyncio
async def test_failed_transfer_returns_the_request_to_the_queue(fixture_data):
    """A transfer the backend refuses must leave the row pending and undecided."""
    data = fixture_data
    ex = await _make_exemption(data, fish_count=999)

    with pytest.raises(HTTPException) as err:
        await QuarantineService.decide_exemption(str(ex.id), ExemptionDecision(approved=True), data["manager"])
    assert err.value.status_code == 400

    ex = await QuarantineExemption.get(ex.id)
    assert ex.status == "pending"
    assert ex.decided_by is None
    assert ex.decided_at is None

    source_ta = await TankAssignment.get(data["source_ta"].id)
    assert source_ta.current_count == 20
