"""
Notification rules.

The three rules are all "is it late yet?" questions, and the interesting cases
sit on the boundary — a minute either side of 5 PM, an hour either side of a
quarantine window, a day either side of the AUPP warning. The builders take the
current time as an argument precisely so those boundaries can be asserted
without freezing the clock, and every test here drives them that way.
"""
from datetime import datetime, time, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.db import init_db
from app.main import app
from app.models.facility import Room, Tank
from app.models.notification import NotificationRead
from app.models.project import Project
from app.models.tank_assignment import TankAssignment
from app.models.user import RoleEnum, StatusEnum, User
from app.models.water_quality_log import WaterQualityLog
from app.services.notification_service import NotificationService
from app.utils.facility_time import (
    as_utc,
    day_bounds_utc,
    facility_datetime,
    facility_today,
    facility_tz,
)
from app.services.notification_service import (
    _format_day,
    _format_hour,
    _join_tank_labels,
)

TEST_TANK_NUMBER = "NOTIF-TEST"
TEST_EMAIL = "notif_staff@uwindsor.ca"
TEST_AUPP = "NOTIF-TEST-AUPP"


def local(day, hour, minute=0):
    """A facility wall-clock time, which is what the builders compare against."""
    return datetime.combine(day, time(hour=hour, minute=minute), tzinfo=facility_tz())


@pytest.fixture
async def env():
    """A tank, a project and a staff member owning only that tank."""
    await init_db()
    await _purge()

    room = await Room.find_one({})
    tank = Tank(
        room_id=str(room.id),
        tank_number=TEST_TANK_NUMBER,
        status="active",
        # Backdated so the lookback treats it as owing logs for past days.
        created_at=datetime.now(timezone.utc) - timedelta(days=30),
    )
    await tank.insert()

    project = Project(
        title="Notification Rule Fixture",
        pi_name="Dr Fixture",
        aupp_number=TEST_AUPP,
        created_by="test",
    )
    await project.insert()

    staff = User(
        email=TEST_EMAIL,
        password_hash="x",
        first_name="Notif",
        last_name="Staff",
        requested_role=RoleEnum.staff,
        role=RoleEnum.staff,
        status=StatusEnum.active,
        assigned_tank_ids=[str(tank.id)],
    )
    await staff.insert()

    yield {"tank": tank, "project": project, "staff": staff}

    await _purge()


async def _purge():
    # Receipts are keyed by the user's id, so they have to go before the user
    # does — otherwise they outlive the fixture and skew the next run's counts.
    staff = await User.find_one({"email": TEST_EMAIL})
    if staff:
        await NotificationRead.find({"user_id": str(staff.id)}).delete()

    await Tank.find({"tank_number": TEST_TANK_NUMBER}).delete()
    await Project.find({"aupp_number": TEST_AUPP}).delete()
    await User.find({"email": TEST_EMAIL}).delete()
    await WaterQualityLog.find({"created_by": "notif-test"}).delete()
    await TankAssignment.find({"created_by": "notif-test"}).delete()


class TestHelpers:
    def test_hour_labels_cover_both_halves_of_the_clock(self):
        # A bare "PM" suffix would be wrong for any morning deadline.
        assert _format_hour(17) == "5 PM"
        assert _format_hour(9) == "9 AM"
        assert _format_hour(0) == "12 AM"
        assert _format_hour(12) == "12 PM"

    def test_day_label_avoids_platform_specific_strftime(self):
        """%-d is glibc-only and %#d is Windows-only; neither may appear."""
        assert _format_day(datetime(2026, 8, 3).date()) == "Aug 3, 2026"
        assert _format_day(datetime(2026, 12, 25).date()) == "Dec 25, 2026"

    @pytest.mark.parametrize(
        "labels,expected",
        [
            (["Tank 1"], "Tank 1"),
            (["Tank 1", "Tank 2"], "Tank 1 and Tank 2"),
            (["Tank 1", "Tank 2", "Tank 3"], "Tank 1, Tank 2 and Tank 3"),
            (["Tank 1", "Tank 2", "Tank 3", "Tank 4"], "Tank 1, Tank 2, Tank 3 and 1 more"),
        ],
    )
    def test_tank_lists_stay_readable(self, labels, expected):
        assert _join_tank_labels(labels) == expected

    def test_day_bounds_are_utc_midnight_to_midnight(self):
        """
        Beanie writes a `date` as a BSON datetime at UTC midnight with no offset
        applied, so the range that matches it has to be built in UTC — deriving
        it from the facility zone would slide the window by four or five hours.
        """
        start, end = day_bounds_utc(datetime(2026, 8, 13).date())
        assert start == datetime(2026, 8, 13, tzinfo=timezone.utc)
        assert end == datetime(2026, 8, 14, tzinfo=timezone.utc)

    def test_naive_timestamps_from_mongo_are_read_as_utc(self):
        naive = datetime(2026, 8, 13, 12, 0)
        assert as_utc(naive) == datetime(2026, 8, 13, 12, 0, tzinfo=timezone.utc)
        assert as_utc(None) is None


class TestWaterQualityDeadline:
    @pytest.mark.asyncio
    async def test_silent_before_the_deadline(self, env):
        today = facility_today()
        items = await NotificationService._water_quality_notifications(
            env["staff"], local(today, settings.WATER_QUALITY_DEADLINE_HOUR - 1, 59)
        )
        assert not [i for i in items if i["meta"]["date"] == today.isoformat()]

    @pytest.mark.asyncio
    async def test_fires_once_the_deadline_passes(self, env):
        today = facility_today()
        items = await NotificationService._water_quality_notifications(
            env["staff"], local(today, settings.WATER_QUALITY_DEADLINE_HOUR)
        )
        today_item = next(i for i in items if i["meta"]["date"] == today.isoformat())

        assert today_item["severity"] == "critical"
        assert today_item["key"] == f"water_quality_missing:{today.isoformat()}"
        numbers = [t["tank_number"] for t in today_item["meta"]["tanks"]]
        assert numbers == [TEST_TANK_NUMBER], "staff must only be told about their own tanks"

    @pytest.mark.asyncio
    async def test_a_logged_tank_drops_out(self, env):
        today = facility_today()
        log = WaterQualityLog(
            tank_id=str(env["tank"].id),
            type="daily",
            date=today,
            parameters={"ph": 7.2},
            created_by="notif-test",
        )
        await log.insert()

        items = await NotificationService._water_quality_notifications(
            env["staff"], local(today, settings.WATER_QUALITY_DEADLINE_HOUR)
        )
        assert not [i for i in items if i["meta"]["date"] == today.isoformat()]

    @pytest.mark.asyncio
    async def test_a_tank_is_not_faulted_for_days_before_it_existed(self, env):
        """A tank added today never owed a log for last week."""
        tank = env["tank"]
        tank.created_at = datetime.now(timezone.utc)
        await tank.save()

        today = facility_today()
        items = await NotificationService._water_quality_notifications(
            env["staff"], local(today, settings.WATER_QUALITY_DEADLINE_HOUR)
        )
        assert [i["meta"]["date"] for i in items] == [today.isoformat()]

    @pytest.mark.asyncio
    async def test_lookback_is_bounded(self, env):
        today = facility_today()
        items = await NotificationService._water_quality_notifications(
            env["staff"], local(today, settings.WATER_QUALITY_DEADLINE_HOUR)
        )
        oldest = min(i["meta"]["date"] for i in items)
        window_start = today - timedelta(days=settings.WATER_QUALITY_MISSING_LOOKBACK_DAYS - 1)
        assert oldest >= window_start.isoformat()

    @pytest.mark.asyncio
    async def test_the_alert_timestamp_is_the_deadline_itself(self, env):
        """
        The bell filters on `created_at`, so a missed 5 PM deadline has to be
        stamped 5 PM — stamping it "now" would keep it inside the 24-hour window
        forever.
        """
        today = facility_today()
        items = await NotificationService._water_quality_notifications(
            env["staff"], local(today, 23, 30)
        )
        today_item = next(i for i in items if i["meta"]["date"] == today.isoformat())
        assert today_item["created_at"] == facility_datetime(
            today, settings.WATER_QUALITY_DEADLINE_HOUR
        )


class TestQuarantineWindow:
    async def _run(self, env, ends_in: timedelta):
        tank = env["tank"]
        now = datetime.now(timezone.utc)
        tank.is_quarantined = True
        tank.quarantine_start_date = now - timedelta(days=13)
        tank.quarantine_end_date = now + ends_in
        await tank.save()
        return await NotificationService._quarantine_notifications(env["staff"], now)

    @pytest.mark.asyncio
    async def test_quiet_outside_the_one_day_window(self, env):
        assert await self._run(env, timedelta(hours=25)) == []

    @pytest.mark.asyncio
    async def test_warns_inside_the_one_day_window(self, env):
        items = await self._run(env, timedelta(hours=23))
        assert len(items) == 1
        assert items[0]["severity"] == "warning"
        assert items[0]["meta"]["expired"] is False
        assert "22 hours" in items[0]["message"] or "23 hours" in items[0]["message"]

    @pytest.mark.asyncio
    async def test_an_overdue_window_escalates_rather_than_disappearing(self, env):
        """
        Dropping the alert the moment the window closes would hide exactly the
        case that needs acting on — a tank still flagged after its release date.
        """
        items = await self._run(env, timedelta(hours=-6))
        assert len(items) == 1
        assert items[0]["severity"] == "critical"
        assert items[0]["meta"]["expired"] is True

    @pytest.mark.asyncio
    async def test_unassigned_staff_are_not_told(self, env):
        env["staff"].assigned_tank_ids = []
        await env["staff"].save()
        assert await self._run(env, timedelta(hours=12)) == []


class TestAuppExpiry:
    async def _run(self, env, expires_in: timedelta, user=None):
        project = env["project"]
        now = datetime.now(timezone.utc)
        project.aupp_expiry_date = now + expires_in
        await project.save()

        # Staff only hear about projects sitting in a tank they are assigned to.
        assignment = TankAssignment(
            project_id=str(project.id),
            tank_id=str(env["tank"].id),
            current_count=5,
            created_by="notif-test",
        )
        await assignment.insert()

        items = await NotificationService._aupp_notifications(user or env["staff"], now)
        return [i for i in items if i["meta"]["aupp_number"] == TEST_AUPP]

    @pytest.mark.asyncio
    async def test_quiet_outside_the_one_month_window(self, env):
        assert await self._run(env, timedelta(days=settings.AUPP_EXPIRY_WARNING_DAYS + 2)) == []

    @pytest.mark.asyncio
    async def test_warns_inside_the_one_month_window(self, env):
        items = await self._run(env, timedelta(days=settings.AUPP_EXPIRY_WARNING_DAYS - 2))
        assert len(items) == 1
        assert items[0]["severity"] == "warning"
        assert items[0]["meta"]["days_left"] == settings.AUPP_EXPIRY_WARNING_DAYS - 2

    @pytest.mark.asyncio
    async def test_the_final_week_is_critical(self, env):
        items = await self._run(env, timedelta(days=3))
        assert items[0]["severity"] == "critical"

    @pytest.mark.asyncio
    async def test_an_expired_aupp_stays_visible(self, env):
        items = await self._run(env, timedelta(days=-2))
        assert items[0]["severity"] == "critical"
        assert items[0]["meta"]["expired"] is True

    @pytest.mark.asyncio
    async def test_a_closed_project_is_not_chased(self, env):
        env["project"].status = "closed"
        await env["project"].save()
        assert await self._run(env, timedelta(days=5)) == []

    @pytest.mark.asyncio
    async def test_alert_predates_the_expiry_by_the_warning_window(self, env):
        """
        Stamped a month ahead of expiry so it shows in the bell on the day it
        starts mattering and then lives on in the panel only.
        """
        items = await self._run(env, timedelta(days=10))
        expiry = as_utc(env["project"].aupp_expiry_date)
        expected = expiry - timedelta(days=settings.AUPP_EXPIRY_WARNING_DAYS)
        assert items[0]["created_at"] == expected


class TestStaffSeeTheMinimum:
    """
    Staff are scoped to their assigned tanks, and the payload is trimmed to
    match: a notification must not hand them facility context — who else works
    the tank, when a window opened, which PI owns the licence — that they cannot
    act on and are not shown elsewhere in the staff views.
    """

    @pytest.mark.asyncio
    async def test_no_tank_roster_for_staff(self, env):
        today = facility_today()
        items = await NotificationService._water_quality_notifications(
            env["staff"], local(today, settings.WATER_QUALITY_DEADLINE_HOUR)
        )
        for item in items:
            for tank in item["meta"]["tanks"]:
                assert "assignees" not in tank

    @pytest.mark.asyncio
    async def test_managers_still_get_the_tank_roster(self, env):
        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        today = facility_today()
        items = await NotificationService._water_quality_notifications(
            admin, local(today, settings.WATER_QUALITY_DEADLINE_HOUR)
        )
        assert items, "the fixture tank has no logs, so managers must see it"
        assert all("assignees" in t for i in items for t in i["meta"]["tanks"])

    @pytest.mark.asyncio
    async def test_quarantine_start_date_is_manager_only(self, env):
        tank = env["tank"]
        now = datetime.now(timezone.utc)
        tank.is_quarantined = True
        tank.quarantine_start_date = now - timedelta(days=13)
        tank.quarantine_end_date = now + timedelta(hours=12)
        await tank.save()

        staff_items = await NotificationService._quarantine_notifications(env["staff"], now)
        assert "quarantine_start_date" not in staff_items[0]["meta"]
        assert "quarantine_end_date" in staff_items[0]["meta"]

        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        admin_items = [
            i
            for i in await NotificationService._quarantine_notifications(admin, now)
            if i["meta"]["tank_number"] == TEST_TANK_NUMBER
        ]
        assert "quarantine_start_date" in admin_items[0]["meta"]

    @pytest.mark.asyncio
    async def test_pi_name_is_manager_only(self, env):
        project = env["project"]
        now = datetime.now(timezone.utc)
        project.aupp_expiry_date = now + timedelta(days=10)
        await project.save()
        await TankAssignment(
            project_id=str(project.id),
            tank_id=str(env["tank"].id),
            current_count=5,
            created_by="notif-test",
        ).insert()

        def only_ours(items):
            return [i for i in items if i["meta"]["aupp_number"] == TEST_AUPP]

        staff_item = only_ours(await NotificationService._aupp_notifications(env["staff"], now))[0]
        assert "pi_name" not in staff_item["meta"]
        assert "Dr Fixture" not in staff_item["message"]
        # Still enough to identify which project is lapsing.
        assert staff_item["meta"]["project_title"] == "Notification Rule Fixture"

        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        admin_item = only_ours(await NotificationService._aupp_notifications(admin, now))[0]
        assert admin_item["meta"]["pi_name"] == "Dr Fixture"
        assert "Dr Fixture" in admin_item["message"]

    @pytest.mark.asyncio
    async def test_unassigned_staff_get_nothing(self, env):
        """Assignment is the whole basis for a staff member's feed."""
        staff = env["staff"]
        staff.assigned_tank_ids = []
        await staff.save()

        feed = await NotificationService.list_notifications(staff)
        assert feed["items"] == []
        assert feed["unread_count"] == 0


class TestReadReceipts:
    @pytest.mark.asyncio
    async def test_marking_read_is_per_user_and_idempotent(self, env):
        staff = env["staff"]
        feed = await NotificationService.list_notifications(staff)
        assert feed["unread_count"] == feed["total"] > 0

        keys = [i["key"] for i in feed["items"]][:2]

        # The missed-log keys are the same string for everyone, so the admin's
        # own read state for them is whatever this dev database happens to hold.
        # Snapshot it and assert it does not move — asserting it starts clean
        # would just be testing the fixture data.
        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})

        async def admin_read_state():
            admin_feed = await NotificationService.list_notifications(admin)
            return {i["key"]: i["read"] for i in admin_feed["items"] if i["key"] in keys}

        before = await admin_read_state()

        assert (await NotificationService.mark_read(staff, keys=keys))["marked"] == 2
        assert (await NotificationService.mark_read(staff, keys=keys))["marked"] == 0

        after = await NotificationService.list_notifications(staff)
        assert after["unread_count"] == feed["unread_count"] - 2
        assert await admin_read_state() == before, "one user's receipts changed another's feed"

        await NotificationRead.find({"user_id": str(staff.id)}).delete()

    @pytest.mark.asyncio
    async def test_mark_all_clears_the_feed(self, env):
        staff = env["staff"]
        await NotificationService.mark_read(staff, mark_all=True)
        assert (await NotificationService.list_notifications(staff))["unread_count"] == 0
        await NotificationRead.find({"user_id": str(staff.id)}).delete()

    @pytest.mark.asyncio
    async def test_the_bell_window_is_a_subset_of_the_panel(self, env):
        staff = env["staff"]
        every = await NotificationService.list_notifications(staff, window="all")
        recent = await NotificationService.list_notifications(staff, window="recent")

        assert len(recent["items"]) <= len(every["items"])
        assert recent["total"] == every["total"], "total counts the whole feed either way"
        assert {i["key"] for i in recent["items"]} <= {i["key"] for i in every["items"]}


class TestEndpoint:
    @pytest.mark.asyncio
    async def test_requires_authentication(self):
        await init_db()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            assert (await ac.get("/notifications")).status_code == 401
            assert (await ac.post("/notifications/mark-read", json={"all": True})).status_code == 401

    @pytest.mark.asyncio
    async def test_rejects_an_unknown_window(self):
        await init_db()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            login = await ac.post(
                "/auth/login",
                json={"email": "superadmin@uwindsor.ca", "password": "ChangeMe123!"},
            )
            headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
            assert (await ac.get("/notifications", params={"window": "nope"}, headers=headers)).status_code == 422

            ok = await ac.get("/notifications", params={"window": "recent"}, headers=headers)
            assert ok.status_code == 200
            assert {"items", "unread_count", "recent_unread_count"} <= ok.json().keys()
