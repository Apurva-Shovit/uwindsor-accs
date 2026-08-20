"""Two admins editing the same user account at the same time.

The three edits below each own one field, but each used to write the whole
record via a save(), which $sets every field from the copy it read. So a role
change reverted a tank-access change made a moment earlier, and neither admin
saw anything go wrong. Verified against the old code path: granting tank-9 and
changing the role concurrently left the role updated and tank-9 gone.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.db import init_db
from app.models.audit_log import AuditLog
from app.models.user import User, RoleEnum, StatusEnum
from app.schemas.user import ApproveRequest, RejectRequest
from app.services.user_service import UserService

ADMIN_EMAIL = "admin.probe@uwindsor.ca"
TARGET_EMAIL = "target.probe@uwindsor.ca"


@pytest.fixture
async def env():
    await init_db()

    admin = User(
        email=ADMIN_EMAIL,
        password_hash="x",
        first_name="Probe",
        last_name="Admin",
        requested_role=RoleEnum.super_admin,
        role=RoleEnum.super_admin,
        status=StatusEnum.active,
    )
    await admin.insert()

    target = User(
        email=TARGET_EMAIL,
        password_hash="x",
        first_name="Probe",
        last_name="Target",
        requested_role=RoleEnum.staff,
        role=RoleEnum.staff,
        status=StatusEnum.active,
        assigned_tank_ids=["tank-1", "tank-2"],
    )
    await target.insert()

    yield {"admin": admin, "target": target}

    await AuditLog.find({"actor_id": str(admin.id)}).delete()
    await User.find({"email": {"$in": [ADMIN_EMAIL, TARGET_EMAIL]}}).delete()


@pytest.mark.asyncio
async def test_a_role_change_does_not_revert_tank_access(env):
    """The clobbering case: two admins, two different fields, one lost edit."""
    target_id = str(env["target"].id)

    await asyncio.gather(
        UserService.update_tank_assignments(target_id, ["tank-1", "tank-2", "tank-9"], env["admin"]),
        UserService.update_user_role(target_id, RoleEnum.manager, env["admin"]),
    )

    fresh = await User.find_one({"email": TARGET_EMAIL})
    assert fresh.role == RoleEnum.manager
    assert "tank-9" in (fresh.assigned_tank_ids or []), "the tank edit was reverted"


@pytest.mark.asyncio
async def test_status_change_is_refused_when_the_account_moved(env):
    """An admin acting on a stale list must not undo a decision they never saw."""
    target_id = str(env["target"].id)

    # Another admin suspends the account.
    await UserService.update_user_status(target_id, StatusEnum.suspended, env["admin"])

    # This admin's screen still shows "active", so their click means "suspend".
    # The baseline they send no longer matches, so the write is refused rather
    # than reinstating someone who was just suspended.
    with pytest.raises(HTTPException) as err:
        await UserService.update_user_status(
            target_id, StatusEnum.active, env["admin"], expected_status=StatusEnum.active
        )
    assert err.value.status_code == 409

    fresh = await User.find_one({"email": TARGET_EMAIL})
    assert fresh.status == StatusEnum.suspended


@pytest.mark.asyncio
async def test_tank_access_is_refused_when_the_list_moved(env):
    """A whole-list save must not erase an edit made while the modal was open."""
    target_id = str(env["target"].id)
    opened_with = ["tank-1", "tank-2"]

    # Another admin grants access to a third tank.
    await UserService.update_tank_assignments(
        target_id, ["tank-1", "tank-2", "tank-7"], env["admin"], expected_tank_ids=opened_with
    )

    # This admin's modal was seeded before that, so their save would drop tank-7.
    with pytest.raises(HTTPException) as err:
        await UserService.update_tank_assignments(
            target_id, ["tank-1"], env["admin"], expected_tank_ids=opened_with
        )
    assert err.value.status_code == 409

    fresh = await User.find_one({"email": TARGET_EMAIL})
    assert "tank-7" in fresh.assigned_tank_ids


@pytest.mark.asyncio
async def test_saving_an_unchanged_value_is_not_a_conflict(env):
    """Re-saving the same role must succeed, not report a phantom conflict."""
    target_id = str(env["target"].id)

    result = await UserService.update_user_role(
        target_id, RoleEnum.staff, env["admin"], expected_role=RoleEnum.staff
    )
    assert result["role"] == RoleEnum.staff.value

    result = await UserService.update_tank_assignments(
        target_id, ["tank-1", "tank-2"], env["admin"], expected_tank_ids=["tank-1", "tank-2"]
    )
    assert result["assigned_tank_ids"] == ["tank-1", "tank-2"]


@pytest.mark.asyncio
async def test_older_clients_still_work(env):
    """Bundles that predate the baseline field must keep functioning."""
    target_id = str(env["target"].id)

    await UserService.update_user_role(target_id, RoleEnum.manager, env["admin"])
    await UserService.update_user_status(target_id, StatusEnum.suspended, env["admin"])
    await UserService.update_tank_assignments(target_id, ["tank-3"], env["admin"])

    fresh = await User.find_one({"email": TARGET_EMAIL})
    assert fresh.role == RoleEnum.manager
    assert fresh.status == StatusEnum.suspended
    assert fresh.assigned_tank_ids == ["tank-3"]


@pytest.mark.asyncio
async def test_concurrent_approvals_settle_on_one_outcome(env):
    """Approve and reject arriving together must not both apply."""
    pending = User(
        email="pending.probe@uwindsor.ca",
        password_hash="x",
        first_name="Probe",
        last_name="Pending",
        requested_role=RoleEnum.staff,
        status=StatusEnum.pending,
    )
    await pending.insert()

    results = await asyncio.gather(
        UserService.approve_user(
            str(pending.id), ApproveRequest(role=RoleEnum.staff, assigned_tank_ids=["tank-1"]), env["admin"]
        ),
        UserService.reject_user(str(pending.id), RejectRequest(reason="probe"), env["admin"]),
        return_exceptions=True,
    )

    refused = [r for r in results if isinstance(r, HTTPException)]
    assert len(refused) == 1, f"expected one rejection, got {results}"

    fresh = await User.find_one({"email": "pending.probe@uwindsor.ca"})
    assert fresh.status in (StatusEnum.active, StatusEnum.rejected)
    assert fresh.status != StatusEnum.pending

    await User.find({"email": "pending.probe@uwindsor.ca"}).delete()
