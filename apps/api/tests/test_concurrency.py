"""Races that two people using the facility at the same time can actually cause.

Every test here fails against the read-modify-write code these replaced. They
run the service functions directly rather than through HTTP, because what is
under test is the interleaving of database operations, not routing -- the same
approach test_quarantine_exemption.py takes for the double-clicked approval.

asyncio.gather is enough to expose these: the services await between the read
and the write, so the event loop interleaves them exactly the way two requests
on one uvicorn worker do.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.db import init_db
from app.models.audit_log import AuditLog
from app.models.census_event import CensusEvent
from app.models.facility import Facility, Room, Tank
from app.models.project import Project
from app.models.tank_assignment import TankAssignment
from app.models.user import User, RoleEnum, StatusEnum
from app.schemas.census import CensusEventCreate
from app.schemas.project import ProjectClose
from app.schemas.transfer import TankTransferCreate
from app.services.census_service import CensusService
from app.services.intake_service import IntakeRequest, IntakeService
from app.services.project_service import ProjectService
from app.services.transfer_service import TransferService
from app.utils.atomic import adjust_count

TEST_EMAIL = "concurrency.probe@uwindsor.ca"
FACILITY_NAME = "Concurrency Probe Facility"
ROOM_NUMBER = "R-CONC"


@pytest.fixture
async def env():
    """A facility with two empty tanks and a manager who may write to both."""
    await init_db()

    fac = Facility(name=FACILITY_NAME, active=True)
    await fac.insert()
    room = Room(facility_id=str(fac.id), room_number=ROOM_NUMBER, active=True)
    await room.insert()

    tank_a = Tank(room_id=str(room.id), tank_number="9001", status="active")
    await tank_a.insert()
    tank_b = Tank(room_id=str(room.id), tank_number="9002", status="active")
    await tank_b.insert()

    manager = User(
        email=TEST_EMAIL,
        password_hash="x",
        first_name="Probe",
        last_name="Manager",
        requested_role=RoleEnum.manager,
        role=RoleEnum.manager,
        status=StatusEnum.active,
    )
    await manager.insert()

    project = Project(
        title="Concurrency Probe",
        pi_name="Dr Probe",
        aupp_number="AUPP-CONC-1",
        status="active",
        created_by=str(manager.id),
    )
    await project.insert()

    other_project = Project(
        title="Concurrency Probe Two",
        pi_name="Dr Probe",
        aupp_number="AUPP-CONC-2",
        status="active",
        created_by=str(manager.id),
    )
    await other_project.insert()

    yield {
        "facility": fac,
        "room": room,
        "tank_a": tank_a,
        "tank_b": tank_b,
        "manager": manager,
        "project": project,
        "other_project": other_project,
    }

    for pid in (str(project.id), str(other_project.id)):
        await CensusEvent.find({"project_id": pid}).delete()
        await TankAssignment.find({"project_id": pid}).delete()
    await AuditLog.find({"actor_id": str(manager.id)}).delete()
    await Project.find({"aupp_number": {"$in": ["AUPP-CONC-1", "AUPP-CONC-2"]}}).delete()
    await Tank.find({"room_id": str(room.id)}).delete()
    await Room.find({"facility_id": str(fac.id)}).delete()
    await Facility.find({"name": FACILITY_NAME}).delete()
    await User.find({"email": TEST_EMAIL}).delete()


async def _stock(env, tank, project, count: int) -> TankAssignment:
    await IntakeService.create_fish_intake(
        IntakeRequest(
            tank_id=str(tank.id),
            project_id=str(project.id),
            count=count,
            event_type="arrival",
        ),
        env["manager"],
    )
    return await TankAssignment.find_one(
        {"tank_id": str(tank.id), "project_id": str(project.id)}
    )


@pytest.mark.asyncio
async def test_concurrent_mortality_entries_are_all_recorded(env):
    """Two staff logging deaths at once: neither entry may be swallowed."""
    ta = await _stock(env, env["tank_a"], env["project"], 100)

    await asyncio.gather(*[
        CensusService.create_census_event(
            CensusEventCreate(
                tank_assignment_id=str(ta.id), event_type="death", change=-change
            ),
            env["manager"],
        )
        for change in (5, 3, 2, 7, 1)
    ])

    ta = await TankAssignment.get(ta.id)
    assert ta.current_count == 100 - (5 + 3 + 2 + 7 + 1)

    deaths = await CensusEvent.find({
        "tank_assignment_id": str(ta.id), "event_type": "death"
    }).to_list()
    assert sum(-e.change for e in deaths) == 18


@pytest.mark.asyncio
async def test_concurrent_withdrawals_cannot_overdraw_a_tank(env):
    """Only as many withdrawals as the tank can cover may succeed."""
    ta = await _stock(env, env["tank_a"], env["project"], 10)

    results = await asyncio.gather(*[
        CensusService.create_census_event(
            CensusEventCreate(
                tank_assignment_id=str(ta.id), event_type="death", change=-4
            ),
            env["manager"],
        )
        for _ in range(5)
    ], return_exceptions=True)

    applied = [r for r in results if not isinstance(r, Exception)]
    refused = [r for r in results if isinstance(r, HTTPException)]

    assert len(applied) == 2, f"expected 2 of 5 withdrawals to fit in 10 fish: {results}"
    assert all(r.status_code == 409 for r in refused)

    ta = await TankAssignment.get(ta.id)
    assert ta.current_count == 2
    assert ta.current_count >= 0

    # The refused entries must not have reached the ledger either.
    deaths = await CensusEvent.find({
        "tank_assignment_id": str(ta.id), "event_type": "death"
    }).to_list()
    assert len(deaths) == 2


@pytest.mark.asyncio
async def test_concurrent_first_intakes_create_one_assignment(env):
    """A find-then-insert would give this tank two rows and hide half the fish."""
    await asyncio.gather(*[
        IntakeService.create_fish_intake(
            IntakeRequest(
                tank_id=str(env["tank_a"].id),
                project_id=str(env["project"].id),
                count=10,
                event_type="arrival",
            ),
            env["manager"],
        )
        for _ in range(5)
    ])

    rows = await TankAssignment.find({
        "tank_id": str(env["tank_a"].id), "project_id": str(env["project"].id)
    }).to_list()
    assert len(rows) == 1, f"expected one assignment row, got {len(rows)}"
    assert rows[0].current_count == 50


@pytest.mark.asyncio
async def test_two_projects_cannot_occupy_one_tank(env):
    """The occupancy invariant has to hold even when both intakes race."""
    results = await asyncio.gather(
        IntakeService.create_fish_intake(
            IntakeRequest(
                tank_id=str(env["tank_a"].id),
                project_id=str(env["project"].id),
                count=10,
                event_type="arrival",
            ),
            env["manager"],
        ),
        IntakeService.create_fish_intake(
            IntakeRequest(
                tank_id=str(env["tank_a"].id),
                project_id=str(env["other_project"].id),
                count=10,
                event_type="arrival",
            ),
            env["manager"],
        ),
        return_exceptions=True,
    )

    refused = [r for r in results if isinstance(r, HTTPException)]
    assert len(refused) == 1, f"expected exactly one rejection, got {results}"
    assert refused[0].status_code == 409

    occupied = await TankAssignment.find({
        "tank_id": str(env["tank_a"].id), "current_count": {"$gt": 0}
    }).to_list()
    assert len(occupied) == 1


@pytest.mark.asyncio
async def test_failed_transfer_puts_the_fish_back(env, monkeypatch):
    """A credit that fails must not leave the animals in neither tank."""
    source_ta = await _stock(env, env["tank_a"], env["project"], 40)

    real_adjust = adjust_count
    calls = {"n": 0}

    async def failing_adjust(assignment_id, delta, **kwargs):
        calls["n"] += 1
        # First call is the debit; fail the credit that follows it.
        if calls["n"] == 2:
            raise RuntimeError("simulated write failure crediting the destination")
        return await real_adjust(assignment_id, delta, **kwargs)

    monkeypatch.setattr("app.services.transfer_service.adjust_count", failing_adjust)

    with pytest.raises(RuntimeError):
        await TransferService.create_tank_transfer(
            TankTransferCreate(
                source_assignment_id=str(source_ta.id),
                destination_tank_id=str(env["tank_b"].id),
                count=15,
            ),
            env["manager"],
        )

    source_ta = await TankAssignment.get(source_ta.id)
    assert source_ta.current_count == 40, "the debit was not compensated"

    dest_ta = await TankAssignment.find_one({"tank_id": str(env["tank_b"].id)})
    assert dest_ta is None or dest_ta.current_count == 0

    orphans = await CensusEvent.find({
        "project_id": str(env["project"].id),
        "event_type": {"$in": ["transfer_out", "transfer_in"]},
    }).to_list()
    assert orphans == [], "a half-finished transfer left entries in the ledger"


@pytest.mark.asyncio
async def test_successful_transfer_moves_every_fish_exactly_once(env):
    source_ta = await _stock(env, env["tank_a"], env["project"], 40)

    await TransferService.create_tank_transfer(
        TankTransferCreate(
            source_assignment_id=str(source_ta.id),
            destination_tank_id=str(env["tank_b"].id),
            count=15,
        ),
        env["manager"],
    )

    source_ta = await TankAssignment.get(source_ta.id)
    dest_ta = await TankAssignment.find_one({"tank_id": str(env["tank_b"].id)})
    assert source_ta.current_count == 25
    assert dest_ta.current_count == 15

    out = await CensusEvent.find({
        "project_id": str(env["project"].id), "event_type": "transfer_out"
    }).to_list()
    inn = await CensusEvent.find({
        "project_id": str(env["project"].id), "event_type": "transfer_in"
    }).to_list()
    assert len(out) == 1 and len(inn) == 1
    assert out[0].transfer_group_id == inn[0].transfer_group_id


@pytest.mark.asyncio
async def test_concurrent_project_closes_dispose_the_fish_once(env):
    """Two managers closing the same project must not bury every animal twice."""
    await _stock(env, env["tank_a"], env["project"], 30)

    results = await asyncio.gather(*[
        ProjectService.close_project(
            str(env["project"].id),
            ProjectClose(disposition_type="euthanized", notes="probe"),
            env["manager"],
        )
        for _ in range(3)
    ], return_exceptions=True)

    refused = [r for r in results if isinstance(r, HTTPException)]
    assert len(refused) == 2, f"expected two rejections, got {results}"
    assert all(r.status_code == 409 for r in refused)

    deaths = await CensusEvent.find({
        "project_id": str(env["project"].id), "event_type": "death"
    }).to_list()
    assert len(deaths) == 1, "the disposition ran more than once"
    assert deaths[0].change == -30

    ta = await TankAssignment.find_one({"tank_id": str(env["tank_a"].id)})
    assert ta.current_count == 0


@pytest.mark.asyncio
async def test_close_records_what_was_really_in_the_tank(env):
    """A late intake must not leave the ledger naming fish that never left."""
    ta = await _stock(env, env["tank_a"], env["project"], 30)

    # Land an extra arrival in the same moment as the close.
    await asyncio.gather(
        ProjectService.close_project(
            str(env["project"].id),
            ProjectClose(disposition_type="euthanized", notes="probe"),
            env["manager"],
        ),
        adjust_count(ta.id, 5),
        return_exceptions=True,
    )

    ta = await TankAssignment.get(ta.id)
    deaths = await CensusEvent.find({
        "project_id": str(env["project"].id), "event_type": "death"
    }).to_list()

    arrivals = await CensusEvent.find({
        "project_id": str(env["project"].id), "event_type": "arrival"
    }).to_list()
    ledger = sum(e.change for e in arrivals) + sum(e.change for e in deaths) + 5

    assert ta.current_count == ledger, (
        f"count {ta.current_count} disagrees with the ledger {ledger}"
    )


@pytest.mark.asyncio
async def test_replayed_census_submission_is_applied_once(env):
    """The dead-zone case: the request landed, the response did not, user re-taps."""
    ta = await _stock(env, env["tank_a"], env["project"], 50)
    key = "probe-census-key-1"

    first = await CensusService.create_census_event(
        CensusEventCreate(
            tank_assignment_id=str(ta.id),
            event_type="death",
            change=-6,
            request_id=key,
        ),
        env["manager"],
    )
    second = await CensusService.create_census_event(
        CensusEventCreate(
            tank_assignment_id=str(ta.id),
            event_type="death",
            change=-6,
            request_id=key,
        ),
        env["manager"],
    )

    assert first.get("duplicate") is None
    assert second["duplicate"] is True
    assert second["new_count"] == first["new_count"]

    ta = await TankAssignment.get(ta.id)
    assert ta.current_count == 44

    deaths = await CensusEvent.find({
        "tank_assignment_id": str(ta.id), "event_type": "death"
    }).to_list()
    assert len(deaths) == 1


@pytest.mark.asyncio
async def test_simultaneous_replays_still_apply_once(env):
    """Even fired together, one key means one change."""
    ta = await _stock(env, env["tank_a"], env["project"], 50)
    key = "probe-census-key-2"

    results = await asyncio.gather(*[
        CensusService.create_census_event(
            CensusEventCreate(
                tank_assignment_id=str(ta.id),
                event_type="death",
                change=-6,
                request_id=key,
            ),
            env["manager"],
        )
        for _ in range(4)
    ], return_exceptions=True)

    assert not [r for r in results if isinstance(r, Exception)], results
    duplicates = [r for r in results if r.get("duplicate")]
    assert len(duplicates) == 3

    ta = await TankAssignment.get(ta.id)
    assert ta.current_count == 44


@pytest.mark.asyncio
async def test_a_rejected_submission_releases_its_key(env):
    """A key burned by a failed attempt would lock the user out of retrying."""
    ta = await _stock(env, env["tank_a"], env["project"], 3)
    key = "probe-census-key-3"

    with pytest.raises(HTTPException):
        await CensusService.create_census_event(
            CensusEventCreate(
                tank_assignment_id=str(ta.id),
                event_type="death",
                change=-99,
                request_id=key,
            ),
            env["manager"],
        )

    # The same key must work once the number is corrected.
    result = await CensusService.create_census_event(
        CensusEventCreate(
            tank_assignment_id=str(ta.id),
            event_type="death",
            change=-2,
            request_id=key,
        ),
        env["manager"],
    )
    assert result.get("duplicate") is None
    assert result["new_count"] == 1


@pytest.mark.asyncio
async def test_replayed_transfer_moves_the_fish_once(env):
    source_ta = await _stock(env, env["tank_a"], env["project"], 40)
    key = "probe-transfer-key-1"

    body = TankTransferCreate(
        source_assignment_id=str(source_ta.id),
        destination_tank_id=str(env["tank_b"].id),
        count=12,
        request_id=key,
    )
    first = await TransferService.create_tank_transfer(body, env["manager"])
    second = await TransferService.create_tank_transfer(body, env["manager"])

    assert second["duplicate"] is True
    assert second["transfer_group_id"] == first["transfer_group_id"]

    source_ta = await TankAssignment.get(source_ta.id)
    dest_ta = await TankAssignment.find_one({"tank_id": str(env["tank_b"].id)})
    assert source_ta.current_count == 28
    assert dest_ta.current_count == 12

    out = await CensusEvent.find({
        "project_id": str(env["project"].id), "event_type": "transfer_out"
    }).to_list()
    assert len(out) == 1


@pytest.mark.asyncio
async def test_submissions_without_a_key_are_unaffected(env):
    """Clients that have not been updated must behave exactly as before."""
    ta = await _stock(env, env["tank_a"], env["project"], 50)

    for _ in range(3):
        await CensusService.create_census_event(
            CensusEventCreate(
                tank_assignment_id=str(ta.id), event_type="death", change=-2
            ),
            env["manager"],
        )

    ta = await TankAssignment.get(ta.id)
    assert ta.current_count == 44
    deaths = await CensusEvent.find({
        "tank_assignment_id": str(ta.id), "event_type": "death"
    }).to_list()
    assert len(deaths) == 3


@pytest.mark.asyncio
async def test_reconciler_finds_and_repairs_drift(env):
    """The backstop: a counter that no longer matches its ledger must be visible."""
    from app.utils.census_reconcile import find_drift, repair

    ta = await _stock(env, env["tank_a"], env["project"], 60)

    assert not [d for d in await find_drift() if d.assignment_id == str(ta.id)]

    # Corrupt the counter the way a lost update used to.
    await TankAssignment.get_motor_collection().update_one(
        {"_id": ta.id}, {"$set": {"current_count": 71}}
    )

    drifted = [d for d in await find_drift() if d.assignment_id == str(ta.id)]
    assert len(drifted) == 1
    assert drifted[0].ledger_total == 60
    assert drifted[0].current_count == 71
    assert drifted[0].delta == 11

    repaired = await repair(drifted, actor_id="test")
    assert repaired == 1

    ta = await TankAssignment.get(ta.id)
    assert ta.current_count == 60
    assert not [d for d in await find_drift() if d.assignment_id == str(ta.id)]

    trail = await AuditLog.find({
        "entity_id": str(ta.id), "action": "census_reconciliation"
    }).to_list()
    assert len(trail) == 1
    await AuditLog.find({"action": "census_reconciliation"}).delete()


@pytest.mark.asyncio
async def test_reconciler_skips_a_count_that_moved_mid_repair(env):
    """A repair computed against a stale value must not overwrite a newer one."""
    from app.utils.census_reconcile import find_drift, repair

    ta = await _stock(env, env["tank_a"], env["project"], 60)
    await TankAssignment.get_motor_collection().update_one(
        {"_id": ta.id}, {"$set": {"current_count": 71}}
    )

    drifted = [d for d in await find_drift() if d.assignment_id == str(ta.id)]

    # Someone records a death between the scan and the repair.
    await CensusService.create_census_event(
        CensusEventCreate(
            tank_assignment_id=str(ta.id), event_type="death", change=-1
        ),
        env["manager"],
    )

    repaired = await repair(drifted, actor_id="test")
    assert repaired == 0, "stale repair clobbered a newer count"

    ta = await TankAssignment.get(ta.id)
    assert ta.current_count == 70
