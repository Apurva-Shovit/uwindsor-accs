"""
Notification rules and the generator that stores them.

The three rules are all "is it late yet?" questions, and the interesting cases
sit on the boundary — a minute either side of the daily cutoff, an hour either
side of a quarantine window, a day either side of the AUPP warning. Rules are
pure functions over a captured snapshot, and the snapshot takes both the current
time and the deadline as arguments, so every boundary here is asserted without
freezing the clock and without depending on whatever deadline happens to be
stored in the database this suite runs against.
"""
import asyncio
import contextlib
import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.db import init_db
from app.main import app
from app.models.audit_log import AuditLog
from app.models.facility import Room, Tank
from app.models.notification import (
    Notification,
    NotificationSettings,
    NotificationSweepState,
)
from app.models.project import Project
from app.models.tank_assignment import TankAssignment
from app.models.user import RoleEnum, StatusEnum, User
from app.models.water_quality_log import WaterQualityLog
from app.services import notification_scheduler
from app.services.facility_service import FacilityService
from app.services.notification_service import (
    QUARANTINE_LIFTED_WINDOW,
    FacilitySnapshot,
    NotificationRules,
    NotificationService,
    _format_day,
    _join_tank_labels,
)
from app.services.notification_settings import Deadline, NotificationSettingsStore
from app.utils.clock import as_utc, day_bounds, is_valid_zone, local_date, now_utc
from app.utils.quarantine_utils import lift_expired_quarantines

TEST_TANK_NUMBER = "NOTIF-TEST"
TEST_EMAIL = "notif_staff@uwindsor.ca"
TEST_AUPP = "NOTIF-TEST-AUPP"

# Fixed for the suite so the rule tests do not move when someone changes the
# deadline in the app; the settings tests exercise the stored value instead.
DEADLINE = Deadline(15, 0, "America/Toronto")


def today_local():
    """Today on the facility clock, which is the day the rules reason about."""
    return local_date(now_utc(), DEADLINE.zone)


def at_deadline(day, offset=timedelta()):
    return DEADLINE.on(day) + offset


async def snapshot(now, deadline=DEADLINE):
    return await FacilitySnapshot.capture(now, deadline)


def _hours_in(message: str) -> int:
    """The hour count out of a quarantine countdown, e.g. 'ends in 14 hours'."""
    match = re.search(r"ends in (\d+) hour", message)
    assert match, f"no countdown in {message!r}"
    return int(match.group(1))


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
    # Stored notifications are keyed by the user's id, so they have to go before
    # the user does or they outlive the fixture and skew the next run.
    staff = await User.find_one({"email": TEST_EMAIL})
    if staff:
        await Notification.find({"user_id": str(staff.id)}).delete()

    # Quarantine audit entries outlive the tank they describe, and the auto-lift
    # rule reads them back for a week — so a release staged by one run would keep
    # generating notices against a tank that no longer exists.
    await AuditLog.find({
        "entity_type": "tank",
        "before.tank_number": TEST_TANK_NUMBER,
    }).delete()

    await Tank.find({"tank_number": TEST_TANK_NUMBER}).delete()
    await Project.find({"aupp_number": TEST_AUPP}).delete()
    await User.find({"email": TEST_EMAIL}).delete()
    await WaterQualityLog.find({"created_by": "notif-test"}).delete()
    await TankAssignment.find({"created_by": "notif-test"}).delete()


class TestHelpers:
    @pytest.mark.parametrize(
        "hour,minute,expected",
        [
            (15, 0, "3:00 PM"),
            (9, 30, "9:30 AM"),
            (0, 5, "12:05 AM"),   # a bare "PM" suffix would be wrong here
            (12, 0, "12:00 PM"),
            (23, 59, "11:59 PM"),
        ],
    )
    def test_deadline_labels_read_like_a_clock(self, hour, minute, expected):
        label = Deadline(hour, minute, "America/Toronto").label()
        assert label.startswith(expected)

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

    def test_the_deadline_keeps_its_wall_clock_across_the_dst_change(self):
        """
        3 PM has to stay 3 PM to the person holding the clipboard. Storing the
        cutoff as a UTC hour instead would silently shift it by an hour every
        March and November.
        """
        deadline = Deadline(15, 0, "America/Toronto")
        winter = deadline.on(datetime(2026, 1, 15).date())
        summer = deadline.on(datetime(2026, 8, 13).date())

        # Same local time, deliberately different UTC instants.
        assert winter == datetime(2026, 1, 15, 20, tzinfo=timezone.utc)
        assert summer == datetime(2026, 8, 13, 19, tzinfo=timezone.utc)
        assert deadline.label(winter).endswith("EST")
        assert deadline.label(summer).endswith("EDT")

    def test_an_unknown_zone_degrades_instead_of_erroring(self):
        """A bad stored value must not take every request down with it."""
        assert Deadline(15, 0, "Mars/Olympus_Mons").label().endswith("UTC")
        assert not is_valid_zone("Mars/Olympus_Mons")
        assert is_valid_zone("America/Toronto")

    def test_day_bounds_are_utc_midnight_to_midnight(self):
        """
        Beanie writes a `date` as a BSON datetime at UTC midnight with no offset
        applied, so the range that matches it has to be built in UTC.
        """
        start, end = day_bounds(datetime(2026, 8, 13).date())
        assert start == datetime(2026, 8, 13, tzinfo=timezone.utc)
        assert end == datetime(2026, 8, 14, tzinfo=timezone.utc)

    def test_naive_timestamps_from_mongo_are_read_as_utc(self):
        naive = datetime(2026, 8, 13, 12, 0)
        assert as_utc(naive) == datetime(2026, 8, 13, 12, 0, tzinfo=timezone.utc)
        assert as_utc(None) is None


class TestWaterQualityDeadline:
    @pytest.mark.asyncio
    async def test_silent_before_the_deadline(self, env):
        today = today_local()
        snap = await snapshot(at_deadline(today) - timedelta(minutes=1))
        items = NotificationRules.water_quality(env["staff"], snap)
        assert not [i for i in items if i["meta"]["date"] == today.isoformat()]

    @pytest.mark.asyncio
    async def test_fires_once_the_deadline_passes(self, env):
        today = today_local()
        snap = await snapshot(at_deadline(today))
        items = NotificationRules.water_quality(env["staff"], snap)
        today_item = next(i for i in items if i["meta"]["date"] == today.isoformat())

        assert today_item["severity"] == "critical"
        assert today_item["key"] == f"water_quality_missing:{today.isoformat()}"
        # The message has to name the cutoff it is holding people to.
        assert DEADLINE.label(at_deadline(today)) in today_item["message"]
        numbers = [t["tank_number"] for t in today_item["meta"]["tanks"]]
        assert numbers == [TEST_TANK_NUMBER], "staff must only be told about their own tanks"

    @pytest.mark.asyncio
    async def test_a_logged_tank_drops_out(self, env):
        today = today_local()
        await WaterQualityLog(
            tank_id=str(env["tank"].id),
            type="daily",
            date=today,
            parameters={"ph": 7.2},
            created_by="notif-test",
        ).insert()

        snap = await snapshot(at_deadline(today))
        items = NotificationRules.water_quality(env["staff"], snap)
        assert not [i for i in items if i["meta"]["date"] == today.isoformat()]

    @pytest.mark.asyncio
    async def test_a_tank_is_not_faulted_for_days_before_it_existed(self, env):
        """A tank added today never owed a log for last week."""
        tank = env["tank"]
        tank.created_at = datetime.now(timezone.utc)
        await tank.save()

        today = today_local()
        snap = await snapshot(at_deadline(today))
        items = NotificationRules.water_quality(env["staff"], snap)
        assert [i["meta"]["date"] for i in items] == [today.isoformat()]

    @pytest.mark.asyncio
    async def test_lookback_is_bounded(self, env):
        today = today_local()
        snap = await snapshot(at_deadline(today))
        items = NotificationRules.water_quality(env["staff"], snap)
        oldest = min(i["meta"]["date"] for i in items)
        window_start = today - timedelta(days=settings.WATER_QUALITY_MISSING_LOOKBACK_DAYS - 1)
        assert oldest >= window_start.isoformat()

    @pytest.mark.asyncio
    async def test_the_alert_timestamp_is_the_deadline_itself(self, env):
        """
        The bell filters on `created_at`, so a missed deadline has to be stamped
        at the deadline — stamping it when the sweeper happened to notice would
        keep a week-old miss looking brand new.
        """
        today = today_local()
        snap = await snapshot(at_deadline(today, timedelta(hours=8, minutes=30)))
        items = NotificationRules.water_quality(env["staff"], snap)
        today_item = next(i for i in items if i["meta"]["date"] == today.isoformat())
        assert today_item["created_at"] == at_deadline(today)


class TestQuarantineWindow:
    async def _run(self, env, ends_in: timedelta):
        tank = env["tank"]
        now = datetime.now(timezone.utc)
        tank.is_quarantined = True
        tank.quarantine_start_date = now - timedelta(days=13)
        tank.quarantine_end_date = now + ends_in
        await tank.save()
        return NotificationRules.quarantine(env["staff"], await snapshot(now))

    @pytest.mark.asyncio
    async def test_quiet_outside_the_one_day_window(self, env):
        assert await self._run(env, timedelta(hours=25)) == []

    @pytest.mark.asyncio
    async def test_warns_inside_the_one_day_window(self, env):
        items = await self._run(env, timedelta(hours=23))
        assert len(items) == 1
        assert items[0]["severity"] == "warning"
        assert items[0]["meta"]["expired"] is False

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


class TestQuarantineAutoLift:
    """
    A window running out releases the tank on its own, and that has to be
    announced: the tank silently becomes transferable, and without a notice the
    only record is an audit row nobody is watching.
    """

    async def _expire(self, env, ended_ago: timedelta = timedelta(minutes=1)):
        """Put the fixture tank in a quarantine that has already run out.

        Drains first: this suite runs against a shared database that may already
        be holding an unrelated expired window, and the release counts asserted
        below have to be about the fixture tank alone.
        """
        await lift_expired_quarantines()

        tank = env["tank"]
        now = now_utc()
        tank.is_quarantined = True
        tank.quarantine_start_date = now - timedelta(days=14) - ended_ago
        tank.quarantine_end_date = now - ended_ago
        await tank.save()
        return now

    @pytest.mark.asyncio
    async def test_an_expired_window_releases_the_tank(self, env):
        await self._expire(env)

        assert await lift_expired_quarantines() == 1

        tank = await Tank.get(str(env["tank"].id))
        assert tank.is_quarantined is False
        assert tank.quarantine_start_date is None and tank.quarantine_end_date is None

    @pytest.mark.asyncio
    async def test_a_live_window_is_left_alone(self, env):
        await lift_expired_quarantines()  # drain anything unrelated first

        tank = env["tank"]
        tank.is_quarantined = True
        tank.quarantine_start_date = now_utc() - timedelta(days=13)
        tank.quarantine_end_date = now_utc() + timedelta(hours=6)
        await tank.save()

        assert await lift_expired_quarantines() == 0
        assert (await Tank.get(str(tank.id))).is_quarantined is True

    @pytest.mark.asyncio
    async def test_releasing_twice_does_nothing_the_second_time(self, env):
        await self._expire(env)
        assert await lift_expired_quarantines() == 1
        assert await lift_expired_quarantines() == 0

    @pytest.mark.asyncio
    async def test_the_release_raises_a_notice_naming_the_system(self, env):
        now = await self._expire(env)
        await lift_expired_quarantines()

        items = NotificationRules.quarantine_lifted(env["staff"], await snapshot(now))
        ours = [i for i in items if i["meta"]["tank_number"] == TEST_TANK_NUMBER]
        assert len(ours) == 1

        item = ours[0]
        assert item["type"] == "quarantine_lifted"
        # Informational: the thing it reports is already done and correct.
        assert item["severity"] == "info"
        assert item["meta"]["automatic"] is True
        assert "released automatically by the system" in item["message"]
        assert "14 days of quarantine" in item["message"]

    @pytest.mark.asyncio
    async def test_the_notice_is_stamped_when_the_release_happened(self, env):
        """Not when the sweeper noticed — a late pass must not look brand new."""
        now = await self._expire(env)
        await lift_expired_quarantines()

        entry = await AuditLog.find({
            "entity_id": str(env["tank"].id), "action": "lifted_quarantine",
        }).sort("-created_at").first_or_none()

        item = [
            i for i in NotificationRules.quarantine_lifted(env["staff"], await snapshot(now))
            if i["meta"]["tank_number"] == TEST_TANK_NUMBER
        ][0]
        assert item["created_at"] == as_utc(entry.created_at)

    @pytest.mark.asyncio
    async def test_a_manual_lift_is_not_announced_as_automatic(self, env):
        """Someone pressing the button already knows they pressed it."""
        now = await self._expire(env)
        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        await FacilityService.toggle_tank_quarantine(str(env["tank"].id), False, 14, admin)

        items = NotificationRules.quarantine_lifted(env["staff"], await snapshot(now))
        assert [i for i in items if i["meta"]["tank_number"] == TEST_TANK_NUMBER] == []

    @pytest.mark.asyncio
    async def test_unassigned_staff_are_not_told(self, env):
        now = await self._expire(env)
        await lift_expired_quarantines()

        env["staff"].assigned_tank_ids = []
        await env["staff"].save()

        items = NotificationRules.quarantine_lifted(env["staff"], await snapshot(now))
        assert [i for i in items if i["meta"]["tank_number"] == TEST_TANK_NUMBER] == []

    @pytest.mark.asyncio
    async def test_the_notice_ages_out_of_the_window(self, env):
        now = await self._expire(env)
        await lift_expired_quarantines()

        def ours(snap):
            return [
                i for i in NotificationRules.quarantine_lifted(env["staff"], snap)
                if i["meta"]["tank_number"] == TEST_TANK_NUMBER
            ]

        assert ours(await snapshot(now))
        later = now + QUARANTINE_LIFTED_WINDOW + timedelta(days=1)
        assert ours(await snapshot(later)) == []

    @pytest.mark.asyncio
    async def test_the_start_date_is_manager_only(self, env):
        now = await self._expire(env)
        await lift_expired_quarantines()
        snap = await snapshot(now)

        def ours(user):
            return [
                i for i in NotificationRules.quarantine_lifted(user, snap)
                if i["meta"]["tank_number"] == TEST_TANK_NUMBER
            ][0]

        staff_item = ours(env["staff"])
        assert "quarantine_start_date" not in staff_item["meta"]
        assert "quarantine_end_date" in staff_item["meta"]

        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        assert "quarantine_start_date" in ours(admin)["meta"]

    @pytest.mark.asyncio
    async def test_the_sweep_releases_and_reports_in_one_pass(self, env):
        """
        The read paths only release when somebody looks. A window closing
        overnight has to be picked up by the sweeper itself.
        """
        await self._expire(env)

        result = await NotificationService.sweep()
        assert result["released"] == 1

        assert (await Tank.get(str(env["tank"].id))).is_quarantined is False
        stored = await Notification.find({
            "user_id": str(env["staff"].id), "type": "quarantine_lifted",
        }).to_list()
        assert len(stored) == 1
        assert "released automatically by the system" in stored[0].message

    @pytest.mark.asyncio
    async def test_two_releases_in_a_day_collapse_to_the_latest(self, env):
        """
        One notice per tank per day. A tank re-quarantined and released again the
        same day must report the second release, not whichever row the database
        happened to hand back last.
        """
        await self._expire(env, ended_ago=timedelta(hours=3))
        await lift_expired_quarantines()

        tank = await Tank.get(str(env["tank"].id))
        tank.is_quarantined = True
        tank.quarantine_start_date = now_utc() - timedelta(days=2)
        tank.quarantine_end_date = now_utc() - timedelta(minutes=1)
        await tank.save()
        await lift_expired_quarantines()

        items = [
            i for i in NotificationRules.quarantine_lifted(env["staff"], await snapshot(now_utc()))
            if i["meta"]["tank_number"] == TEST_TANK_NUMBER
        ]
        assert len(items) == 1

        # Identified by which release it points at rather than by the span text:
        # Mongo keeps only milliseconds, so a window set to exactly two days
        # reads back a hair under and the duration floors to "1 day, 23 hrs".
        latest = await AuditLog.find({
            "entity_id": str(tank.id), "action": "lifted_quarantine",
        }).sort("-created_at").first_or_none()
        assert items[0]["created_at"] == as_utc(latest.created_at)
        assert "14 days" not in items[0]["message"], "reported the superseded release"

    @pytest.mark.asyncio
    async def test_a_second_sweep_neither_releases_nor_duplicates(self, env):
        await self._expire(env)
        await NotificationService.sweep()

        second = await NotificationService.sweep()
        assert second["released"] == 0
        assert (second["created"], second["updated"], second["removed"]) == (0, 0, 0)


class TestAuppExpiry:
    async def _run(self, env, expires_in: timedelta, user=None):
        project = env["project"]
        now = datetime.now(timezone.utc)
        project.aupp_expiry_date = now + expires_in
        await project.save()

        # Staff only hear about projects sitting in a tank they are assigned to.
        if not await TankAssignment.find_one({"created_by": "notif-test"}):
            await TankAssignment(
                project_id=str(project.id),
                tank_id=str(env["tank"].id),
                current_count=5,
                created_by="notif-test",
            ).insert()

        items = NotificationRules.aupp(user or env["staff"], await snapshot(now))
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
        snap = await snapshot(at_deadline(today_local()))
        for item in NotificationRules.water_quality(env["staff"], snap):
            for tank in item["meta"]["tanks"]:
                assert "assignees" not in tank

    @pytest.mark.asyncio
    async def test_managers_still_get_the_tank_roster(self, env):
        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        snap = await snapshot(at_deadline(today_local()))
        items = NotificationRules.water_quality(admin, snap)
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
        snap = await snapshot(now)

        staff_items = NotificationRules.quarantine(env["staff"], snap)
        assert "quarantine_start_date" not in staff_items[0]["meta"]
        assert "quarantine_end_date" in staff_items[0]["meta"]

        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        admin_items = [
            i for i in NotificationRules.quarantine(admin, snap)
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
        snap = await snapshot(now)

        def only_ours(items):
            return [i for i in items if i["meta"]["aupp_number"] == TEST_AUPP]

        staff_item = only_ours(NotificationRules.aupp(env["staff"], snap))[0]
        assert "pi_name" not in staff_item["meta"]
        assert "Dr Fixture" not in staff_item["message"]
        # Still enough to identify which project is lapsing.
        assert staff_item["meta"]["project_title"] == "Notification Rule Fixture"

        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        admin_item = only_ours(NotificationRules.aupp(admin, snap))[0]
        assert admin_item["meta"]["pi_name"] == "Dr Fixture"
        assert "Dr Fixture" in admin_item["message"]

    @pytest.mark.asyncio
    async def test_unassigned_staff_get_nothing(self, env):
        """Assignment is the whole basis for a staff member's feed."""
        staff = env["staff"]
        staff.assigned_tank_ids = []
        await staff.save()

        snap = await snapshot(at_deadline(today_local()))
        assert NotificationRules.for_user(staff, snap) == []


class TestGenerator:
    """
    The sweeper reconciles rather than appends: it must converge on the same
    stored set no matter how many times it runs, refresh a live countdown in
    place, and clear an alert once its condition resolves.
    """

    @pytest.mark.asyncio
    async def test_first_pass_writes_the_feed(self, env):
        staff = env["staff"]
        snap = await snapshot(at_deadline(today_local()))
        created, updated, removed = await NotificationService._reconcile_user(staff, snap)

        assert created > 0 and updated == 0 and removed == 0
        assert await Notification.find({"user_id": str(staff.id)}).count() == created

    @pytest.mark.asyncio
    async def test_a_second_pass_over_unchanged_data_writes_nothing(self, env):
        staff = env["staff"]
        snap = await snapshot(at_deadline(today_local()))
        await NotificationService._reconcile_user(staff, snap)

        assert await NotificationService._reconcile_user(staff, snap) == (0, 0, 0)

    @pytest.mark.asyncio
    async def test_a_live_countdown_is_refreshed_in_place(self, env):
        staff, tank = env["staff"], env["tank"]
        now = datetime.now(timezone.utc)
        tank.is_quarantined = True
        tank.quarantine_start_date = now - timedelta(days=13)
        tank.quarantine_end_date = now + timedelta(hours=20)
        await tank.save()

        await NotificationService._reconcile_user(staff, await snapshot(now))
        before = await Notification.find_one({"user_id": str(staff.id), "type": "quarantine_expiring"})

        # Six hours later the same alert must say six fewer hours, not appear twice.
        _, updated, _ = await NotificationService._reconcile_user(
            staff, await snapshot(now + timedelta(hours=6))
        )
        assert updated == 1
        after = await Notification.find({"user_id": str(staff.id), "type": "quarantine_expiring"}).to_list()
        assert len(after) == 1

        # Compared as a delta rather than against a literal: Mongo keeps
        # milliseconds, so a window set to exactly 20h away reads back a hair
        # under and the countdown floors to 19.
        assert _hours_in(before.message) - _hours_in(after[0].message) == 6

    @pytest.mark.asyncio
    async def test_a_resolved_condition_is_cleared(self, env):
        staff, tank = env["staff"], env["tank"]
        now = datetime.now(timezone.utc)
        tank.is_quarantined = True
        tank.quarantine_end_date = now + timedelta(hours=12)
        await tank.save()
        await NotificationService._reconcile_user(staff, await snapshot(now))
        assert await Notification.find({"user_id": str(staff.id), "type": "quarantine_expiring"}).count() == 1

        tank.is_quarantined = False
        await tank.save()
        _, _, removed = await NotificationService._reconcile_user(staff, await snapshot(now))
        assert removed == 1
        assert await Notification.find({"user_id": str(staff.id), "type": "quarantine_expiring"}).count() == 0

    @pytest.mark.asyncio
    async def test_a_missed_deadline_survives_a_late_log(self, env):
        """
        Logging a tank at 6 PM does not un-miss the 5 PM cutoff, so the alert
        stays and keeps the wording it had when the deadline passed.
        """
        staff, today = env["staff"], today_local()
        snap = await snapshot(at_deadline(today))
        await NotificationService._reconcile_user(staff, snap)

        key = f"water_quality_missing:{today.isoformat()}"
        original = await Notification.find_one({"user_id": str(staff.id), "key": key})
        assert original is not None

        await WaterQualityLog(
            tank_id=str(env["tank"].id),
            type="daily",
            date=today,
            parameters={"ph": 7.2},
            created_by="notif-test",
        ).insert()

        later = await snapshot(at_deadline(today) + timedelta(hours=1))
        still_firing = {i["key"] for i in NotificationRules.water_quality(staff, later)}
        assert key not in still_firing, "the rule itself stops firing for that day"

        await NotificationService._reconcile_user(staff, later)
        kept = await Notification.find_one({"user_id": str(staff.id), "key": key})
        assert kept is not None, "a missed deadline is a fact, not a live condition"
        assert kept.message == original.message

    @pytest.mark.asyncio
    async def test_a_missed_deadline_is_dropped_once_it_ages_out(self, env):
        staff, today = env["staff"], today_local()
        await NotificationService._reconcile_user(staff, await snapshot(at_deadline(today)))
        key = f"water_quality_missing:{today.isoformat()}"
        assert await Notification.find_one({"user_id": str(staff.id), "key": key})

        # Far enough ahead that today has fallen out of the lookback window.
        future = at_deadline(today + timedelta(days=30))
        await NotificationService._reconcile_user(staff, await snapshot(future))
        assert await Notification.find_one({"user_id": str(staff.id), "key": key}) is None

    @pytest.mark.asyncio
    async def test_refreshing_an_alert_does_not_mark_it_unread_again(self, env):
        staff, tank = env["staff"], env["tank"]
        now = datetime.now(timezone.utc)
        tank.is_quarantined = True
        tank.quarantine_end_date = now + timedelta(hours=20)
        await tank.save()
        await NotificationService._reconcile_user(staff, await snapshot(now))

        await NotificationService.mark_read(staff, mark_all=True)
        await NotificationService._reconcile_user(staff, await snapshot(now + timedelta(hours=6)))

        doc = await Notification.find_one({"user_id": str(staff.id), "type": "quarantine_expiring"})
        assert doc.read is True, "a ticking countdown is not new information"

    @pytest.mark.asyncio
    async def test_sweep_records_what_it_did(self, env):
        result = await NotificationService.sweep()
        assert result["users"] > 0
        assert set(result) >= {"created", "updated", "removed", "duration_ms", "swept_at"}

        state = await NotificationSweepState.find_one({"singleton": "notification-sweep"})
        assert state is not None and state.error is None

    @pytest.mark.asyncio
    async def test_sweep_is_idempotent(self, env):
        await NotificationService.sweep()
        second = await NotificationService.sweep()
        assert (second["created"], second["updated"], second["removed"]) == (0, 0, 0)


class TestReadState:
    @pytest.mark.asyncio
    async def test_marking_read_is_per_user_and_idempotent(self, env):
        staff = env["staff"]
        await NotificationService._reconcile_user(
            staff, await snapshot(at_deadline(today_local()))
        )
        feed = await NotificationService.list_notifications(staff)
        assert feed["unread_count"] == feed["total"] > 0

        keys = [i["key"] for i in feed["items"]][:2]

        # Water-quality keys are the same string for everyone, so the admin's own
        # read state is whatever this database happens to hold. Snapshot it and
        # assert it does not move; asserting it starts clean would just be
        # testing the fixture data.
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

    @pytest.mark.asyncio
    async def test_mark_all_clears_the_feed(self, env):
        staff = env["staff"]
        await NotificationService._reconcile_user(
            staff, await snapshot(at_deadline(today_local()))
        )
        await NotificationService.mark_read(staff, mark_all=True)
        assert (await NotificationService.list_notifications(staff))["unread_count"] == 0

    @pytest.mark.asyncio
    async def test_the_bell_window_is_a_subset_of_the_panel(self, env):
        staff = env["staff"]
        await NotificationService._reconcile_user(
            staff, await snapshot(at_deadline(today_local()))
        )
        every = await NotificationService.list_notifications(staff, window="all")
        recent = await NotificationService.list_notifications(staff, window="recent")

        assert len(recent["items"]) <= len(every["items"])
        assert recent["total"] == every["total"], "total counts the whole feed either way"
        assert {i["key"] for i in recent["items"]} <= {i["key"] for i in every["items"]}


class TestScheduler:
    """
    The sweeper runs on the API's own event loop, so a fault in it must stay
    contained: a failing pass cannot take the process down, cannot stop later
    passes, and has to leave a trace rather than failing silently.
    """

    @pytest.mark.asyncio
    async def test_start_and_stop_are_clean(self, env):
        await init_db()
        holder = SimpleNamespace(state=SimpleNamespace())

        notification_scheduler.start(holder)
        task = holder.state.notification_sweeper
        assert task is not None and not task.done()

        await notification_scheduler.stop(holder)
        assert task.cancelled() or task.done()
        assert holder.state.notification_sweeper is None

    @pytest.mark.asyncio
    async def test_stopping_a_scheduler_that_never_started_is_a_no_op(self):
        await notification_scheduler.stop(SimpleNamespace(state=SimpleNamespace()))

    @pytest.mark.asyncio
    async def test_a_failing_pass_is_recorded_and_does_not_kill_the_loop(self, env, monkeypatch):
        await init_db()

        async def boom():
            raise RuntimeError("mongo went away")

        monkeypatch.setattr(NotificationService, "sweep", staticmethod(boom))

        task = asyncio.create_task(notification_scheduler.notification_sweeper())
        # Long enough for one failed pass; the loop then backs off and sleeps.
        await asyncio.sleep(0.3)
        still_running = not task.done()
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

        assert still_running, "one bad pass must not end the sweeper"
        state = await NotificationSweepState.find_one({"singleton": "notification-sweep"})
        assert state is not None and "mongo went away" in (state.error or "")

    @pytest.mark.asyncio
    async def test_a_later_success_clears_the_recorded_failure(self, env):
        await init_db()
        await NotificationService.record_sweep_failure("earlier problem")
        await NotificationService.sweep()

        state = await NotificationSweepState.find_one({"singleton": "notification-sweep"})
        assert state.error is None

        # The feed only advertises a generation time it can stand behind.
        feed = await NotificationService.list_notifications(env["staff"])
        assert feed["last_generated_at"] is not None

    @pytest.mark.asyncio
    async def test_the_feed_admits_when_generation_is_broken(self, env):
        await init_db()
        await NotificationService.record_sweep_failure("still broken")

        feed = await NotificationService.list_notifications(env["staff"])
        assert feed["last_generated_at"] is None, "a failed pass is not a successful check"

        await NotificationService.sweep()


class TestDeadlineSettings:
    """
    The cutoff is policy, so only chair, admin and super admin may move it — and
    moving it has to actually change what the rules do, not just what a settings
    screen displays.
    """

    @pytest.fixture(autouse=True)
    async def restore_settings(self):
        """Whatever a test does to the deadline, put the original back."""
        await init_db()
        before = await NotificationSettingsStore.get()
        original = (
            before.water_quality_deadline_hour,
            before.water_quality_deadline_minute,
            before.timezone,
        )
        yield
        record = await NotificationSettingsStore.get()
        (
            record.water_quality_deadline_hour,
            record.water_quality_deadline_minute,
            record.timezone,
        ) = original
        await record.save()

    @pytest.mark.asyncio
    async def test_defaults_to_three_pm_eastern(self):
        await NotificationSettings.find({}).delete()
        deadline = await NotificationSettingsStore.deadline()

        assert (deadline.hour, deadline.minute) == (15, 0)
        assert deadline.timezone == "America/Toronto"
        assert deadline.label().startswith("3:00 PM E")

    @pytest.mark.asyncio
    async def test_a_stored_deadline_survives_a_restart(self):
        """
        Config only seeds an empty database. If the seed ever won over the
        stored row, every redeploy would quietly undo the chair's change.
        """
        record = await NotificationSettingsStore.get()
        record.water_quality_deadline_hour = 9
        record.water_quality_deadline_minute = 45
        await record.save()

        again = await NotificationSettingsStore.deadline()
        assert (again.hour, again.minute) == (9, 45)
        assert settings.WATER_QUALITY_DEADLINE_HOUR == 15, "the seed value is untouched"

    @pytest.mark.asyncio
    async def test_moving_the_deadline_moves_when_the_rule_fires(self, env):
        """The setting is only real if the rules follow it."""
        today = today_local()
        early, late = Deadline(9, 0, "America/Toronto"), Deadline(21, 0, "America/Toronto")
        noon = Deadline(12, 0, "America/Toronto").on(today)

        fired = NotificationRules.water_quality(env["staff"], await snapshot(noon, early))
        assert [i for i in fired if i["meta"]["date"] == today.isoformat()]

        quiet = NotificationRules.water_quality(env["staff"], await snapshot(noon, late))
        assert not [i for i in quiet if i["meta"]["date"] == today.isoformat()]

    @pytest.mark.asyncio
    async def test_updating_regenerates_alerts_against_the_new_cutoff(self, env):
        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        today = today_local()

        await NotificationService.update_settings(9, 0, "America/Toronto", admin)
        after_early = await Notification.find_one(
            {"user_id": str(env["staff"].id), "key": f"water_quality_missing:{today.isoformat()}"}
        )
        assert after_early is not None
        assert "9:00 AM" in after_early.message

        result = await NotificationService.update_settings(21, 30, "America/Toronto", admin)
        assert result["changed"] is True

        # 9:30 PM has not passed yet, so today's alert should be gone entirely
        # rather than left behind quoting a cutoff nobody is held to.
        after_late = await Notification.find_one(
            {"user_id": str(env["staff"].id), "key": f"water_quality_missing:{today.isoformat()}"}
        )
        assert after_late is None

    @pytest.mark.asyncio
    async def test_saving_the_same_values_is_a_no_op(self, env):
        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        current = await NotificationSettingsStore.deadline()
        result = await NotificationService.update_settings(
            current.hour, current.minute, current.timezone, admin
        )
        assert result["changed"] is False

    @pytest.mark.asyncio
    async def test_a_change_is_audited(self, env):
        from app.models.audit_log import AuditLog

        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        await NotificationService.update_settings(16, 15, "America/Toronto", admin)

        entry = await AuditLog.find({"entity_type": "notification_settings"}).sort("-created_at").first_or_none()
        assert entry is not None
        assert entry.actor_id == str(admin.id)
        assert entry.after["water_quality_deadline_hour"] == 16

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "hour,minute,zone",
        [(24, 0, "America/Toronto"), (-1, 0, "America/Toronto"), (15, 60, "America/Toronto"),
         (15, 0, "Mars/Olympus_Mons"), (15, 0, "")],
    )
    async def test_nonsense_values_are_rejected(self, env, hour, minute, zone):
        from fastapi import HTTPException

        admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
        with pytest.raises(HTTPException) as exc:
            await NotificationService.update_settings(hour, minute, zone, admin)
        assert exc.value.status_code == 422

    @pytest.mark.asyncio
    async def test_only_chairs_and_admins_may_move_it(self, env):
        await init_db()
        payload = {"hour": 16, "minute": 0, "timezone": "America/Toronto"}

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            staff = {"Authorization": f"Bearer {_token(env['staff'])}"}
            assert (await ac.get("/notifications/settings", headers=staff)).status_code == 403
            assert (await ac.put("/notifications/settings", json=payload, headers=staff)).status_code == 403

            manager = await User.find_one({"role": RoleEnum.manager, "status": StatusEnum.active})
            if manager:
                headers = {"Authorization": f"Bearer {_token(manager)}"}
                # Managers run the day; they can read the cutoff but not set it.
                assert (await ac.get("/notifications/settings", headers=headers)).status_code == 200
                assert (await ac.put("/notifications/settings", json=payload, headers=headers)).status_code == 403

            admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
            headers = {"Authorization": f"Bearer {_token(admin)}"}
            res = await ac.put("/notifications/settings", json=payload, headers=headers)
            assert res.status_code == 200
            assert res.json()["deadline"]["hour"] == 16

    @pytest.mark.asyncio
    async def test_the_endpoint_validates_before_it_stores(self, env):
        await init_db()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            admin = await User.find_one({"email": "superadmin@uwindsor.ca"})
            headers = {"Authorization": f"Bearer {_token(admin)}"}

            assert (await ac.put(
                "/notifications/settings",
                json={"hour": 99, "minute": 0, "timezone": "America/Toronto"},
                headers=headers,
            )).status_code == 422
            assert (await ac.put(
                "/notifications/settings",
                json={"hour": 15, "minute": 0, "timezone": "Nowhere/Special"},
                headers=headers,
            )).status_code == 422


class TestEndpoint:
    @pytest.mark.asyncio
    async def test_requires_authentication(self):
        await init_db()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            assert (await ac.get("/notifications")).status_code == 401
            assert (await ac.post("/notifications/mark-read", json={"all": True})).status_code == 401
            assert (await ac.post("/notifications/sweep")).status_code == 401
            assert (await ac.get("/notifications/settings")).status_code == 401
            assert (await ac.put("/notifications/settings", json={"hour": 15})).status_code == 401

    @pytest.mark.asyncio
    async def test_manual_sweep_is_manager_only(self, env):
        await init_db()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            staff_token = _token(env["staff"])
            res = await ac.post("/notifications/sweep", headers={"Authorization": f"Bearer {staff_token}"})
            assert res.status_code == 403

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
            body = ok.json()
            assert {"items", "unread_count", "recent_unread_count", "deadline"} <= body.keys()
            # Staff cannot change the cutoff but are held to it, so every feed
            # response carries it.
            assert {"hour", "minute", "timezone", "label"} == body["deadline"].keys()


def _token(user: User) -> str:
    from app.core.security import create_access_token

    return create_access_token(str(user.id), user.role.value)
