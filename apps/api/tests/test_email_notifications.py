"""
Tests for email notification service, settings updates, and deduplicated email dispatches.
"""
import pytest
from datetime import datetime, timedelta, timezone

from app.db import init_db
from app.models.facility import Room, Tank
from app.models.notification import NotificationSettings
from app.models.email_log import EmailLog
from app.models.user import RoleEnum, StatusEnum, User
from app.services import email_service
from app.services.notification_service import NotificationService
from app.services.notification_settings import NotificationSettingsStore

TEST_TANK_1 = "EMAIL-TEST-1"
TEST_TANK_2 = "EMAIL-TEST-2"
STAFF_EMAIL = "staff_test_email@uwindsor.ca"
MANAGER_EMAIL = "manager_test_email@uwindsor.ca"
CHAIR_EMAIL = "chair_test_email@uwindsor.ca"


async def purge_db():
    await EmailLog.find_all().delete()
    await Tank.find({"tank_number": {"$in": [TEST_TANK_1, TEST_TANK_2]}}).delete()
    await User.find({"email": {"$in": [STAFF_EMAIL, MANAGER_EMAIL, CHAIR_EMAIL]}}).delete()


@pytest.fixture
async def email_env():
    await init_db()
    await purge_db()

    room = await Room.find_one({})
    tank1 = Tank(
        room_id=str(room.id),
        tank_number=TEST_TANK_1,
        status="active",
        created_at=datetime.now(timezone.utc) - timedelta(days=30),
    )
    await tank1.insert()

    tank2 = Tank(
        room_id=str(room.id),
        tank_number=TEST_TANK_2,
        status="active",
        created_at=datetime.now(timezone.utc) - timedelta(days=30),
    )
    await tank2.insert()

    staff = User(
        email=STAFF_EMAIL,
        password_hash="test",
        first_name="Sam",
        last_name="Staff",
        requested_role=RoleEnum.staff,
        role=RoleEnum.staff,
        status=StatusEnum.active,
        assigned_tank_ids=[str(tank1.id)],
    )
    await staff.insert()

    manager = User(
        email=MANAGER_EMAIL,
        password_hash="test",
        first_name="Mona",
        last_name="Manager",
        requested_role=RoleEnum.manager,
        role=RoleEnum.manager,
        status=StatusEnum.active,
    )
    await manager.insert()

    chair = User(
        email=CHAIR_EMAIL,
        password_hash="test",
        first_name="Charles",
        last_name="Chair",
        requested_role=RoleEnum.chair,
        role=RoleEnum.chair,
        status=StatusEnum.active,
    )
    await chair.insert()

    yield {
        "tank1": tank1,
        "tank2": tank2,
        "staff": staff,
        "manager": manager,
        "chair": chair,
    }

    await purge_db()


@pytest.mark.asyncio
async def test_render_missing_log_email():
    subject, body_text, body_html = email_service.render_missing_log_email(
        staff_name="Sam Staff",
        tank_labels=["Tank EMAIL-TEST-1"],
        missing_date_formatted="Sep 8, 2026",
        deadline_label="3:00 PM EDT",
    )
    assert "[ACARE Alert]" in subject
    assert "Sam Staff" in body_text
    assert "Tank EMAIL-TEST-1" in body_html
    assert "Sep 8, 2026" in body_text
    assert "3:00 PM EDT" in body_html


@pytest.mark.asyncio
async def test_email_dispatch_and_deduplication(email_env, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(settings, "RESEND_API_KEY", "")

    settings_rec = await NotificationSettingsStore.get()
    settings_rec.sender_email = "custom-sender@uwindsor.ca"
    await settings_rec.save()

    now = datetime.now(timezone.utc)

    # First sweep - should create EmailLog entry and dispatch mock email
    res1 = await NotificationService.sweep(now=now, force=True)
    assert res1["status"] == "completed"
    emailed1 = res1["emailed"]
    assert emailed1["mock_sent"] >= 1

    logs = await EmailLog.find_all().to_list()
    assert len(logs) >= 1

    staff_log = next((l for l in logs if l.recipient_email == STAFF_EMAIL), None)
    assert staff_log is not None
    assert staff_log.sender_email == "custom-sender@uwindsor.ca"
    assert TEST_TANK_1 in staff_log.tank_numbers
    assert MANAGER_EMAIL in staff_log.cc_emails or CHAIR_EMAIL in staff_log.cc_emails

    # Second sweep - deduplication MUST prevent re-sending emails for the same missing log
    res2 = await NotificationService.sweep(now=now, force=True)
    emailed2 = res2["emailed"]
    assert emailed2["mock_sent"] == 0

    logs_after = await EmailLog.find_all().to_list()
    assert len(logs_after) == len(logs)


@pytest.mark.asyncio
async def test_update_notification_settings_sender_email(email_env):
    chair = email_env["chair"]
    updated = await NotificationService.update_settings(
        hour=16,
        minute=30,
        timezone_name="America/Toronto",
        current_user=chair,
        sender_email="facility-alerts@uwindsor.ca",
        email_notifications_enabled=True,
    )
    assert updated["changed"] is True
    assert updated["sender_email"] == "facility-alerts@uwindsor.ca"
    assert updated["email_notifications_enabled"] is True

    record = await NotificationSettingsStore.get()
    assert record.sender_email == "facility-alerts@uwindsor.ca"
