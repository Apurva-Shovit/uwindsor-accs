"""
FCM push delivery: registration, dispatch, and the failure paths.

Nothing here talks to Google. The service-account credentials and the HTTP calls
are both substituted, because what is worth asserting is the decisions the module
makes around the send — which alerts go out, which device rows survive a
rejection, and whether a broken FCM can take the sweep down with it — not that
httpx can post a body.

The RSA key below is generated per-run rather than committed: the token-exchange
path signs a real JWT, and a hardcoded private key in a repo is a liability even
when it protects nothing.
"""
import json
from datetime import timedelta

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

from app.db import init_db
from app.models.device_token import DeviceToken
from app.models.notification import Notification
from app.models.user import RoleEnum, StatusEnum, User
from app.services import push_service
from app.services.notification_service import NotificationService

TEST_EMAIL = "push_staff@uwindsor.ca"
OTHER_EMAIL = "push_staff2@uwindsor.ca"
TOKEN = "fcm-token-aaaaaaaaaaaaaaaaaaaaaaaa"


def _service_account() -> dict:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    return {
        "type": "service_account",
        "project_id": "acare-test",
        "client_email": "push@acare-test.iam.gserviceaccount.com",
        "private_key": pem,
    }


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = json.dumps(self._payload)

    def json(self):
        return self._payload


class _FakeClient:
    """Stands in for httpx.AsyncClient, recording every message it was given."""

    def __init__(self, responses, sent):
        self._responses = responses
        self._sent = sent

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None, data=None):
        self._sent.append({"url": url, "json": json, "data": data})
        result = self._responses
        return result(len(self._sent) - 1) if callable(result) else result


@pytest.fixture
async def configured(monkeypatch):
    """Push switched on with throwaway credentials and a stubbed access token."""
    creds = _service_account()
    monkeypatch.setattr(push_service, "_load_service_account", lambda: creds)

    async def _token():
        return "stub-access-token"

    monkeypatch.setattr(push_service, "_access_token", _token)
    return creds


@pytest.fixture
async def users():
    await init_db()
    await _purge()

    made = []
    for email in (TEST_EMAIL, OTHER_EMAIL):
        user = User(
            email=email,
            password_hash="x",
            first_name="Push",
            last_name="Tester",
            requested_role=RoleEnum.staff,
            role=RoleEnum.staff,
            status=StatusEnum.active,
        )
        await user.insert()
        made.append(user)

    yield {"staff": made[0], "other": made[1]}

    await _purge()


async def _purge():
    for email in (TEST_EMAIL, OTHER_EMAIL):
        user = await User.find_one({"email": email})
        if user:
            await DeviceToken.find({"user_id": str(user.id)}).delete()
            await Notification.find({"user_id": str(user.id)}).delete()
    await DeviceToken.find({"token": TOKEN}).delete()
    await User.find({"email": {"$in": [TEST_EMAIL, OTHER_EMAIL]}}).delete()


class TestConfiguration:
    def test_disabled_when_nothing_is_configured(self, monkeypatch):
        monkeypatch.setattr(push_service.settings, "FCM_SERVICE_ACCOUNT_JSON", "")
        monkeypatch.setattr(push_service.settings, "FCM_SERVICE_ACCOUNT_FILE", "")
        assert push_service.is_enabled() is False
        assert push_service.project_id() is None

    def test_reads_inline_json(self, monkeypatch):
        creds = _service_account()
        monkeypatch.setattr(
            push_service.settings, "FCM_SERVICE_ACCOUNT_JSON", json.dumps(creds)
        )
        monkeypatch.setattr(push_service.settings, "FCM_SERVICE_ACCOUNT_FILE", "")
        assert push_service.is_enabled() is True
        assert push_service.project_id() == "acare-test"

    def test_reads_a_file(self, monkeypatch, tmp_path):
        creds = _service_account()
        path = tmp_path / "sa.json"
        path.write_text(json.dumps(creds), encoding="utf-8")
        monkeypatch.setattr(push_service.settings, "FCM_SERVICE_ACCOUNT_JSON", "")
        monkeypatch.setattr(push_service.settings, "FCM_SERVICE_ACCOUNT_FILE", str(path))
        assert push_service.is_enabled() is True

    def test_incomplete_credentials_do_not_enable_push(self, monkeypatch):
        # A truncated paste is a likelier deployment mistake than a missing one,
        # and must not read as configured — that would fail every send silently.
        monkeypatch.setattr(
            push_service.settings,
            "FCM_SERVICE_ACCOUNT_JSON",
            json.dumps({"project_id": "acare-test"}),
        )
        monkeypatch.setattr(push_service.settings, "FCM_SERVICE_ACCOUNT_FILE", "")
        assert push_service.is_enabled() is False

    def test_malformed_json_does_not_raise(self, monkeypatch):
        monkeypatch.setattr(push_service.settings, "FCM_SERVICE_ACCOUNT_JSON", "{not json")
        monkeypatch.setattr(push_service.settings, "FCM_SERVICE_ACCOUNT_FILE", "")
        assert push_service.is_enabled() is False


class TestAccessToken:
    """
    The one path the other tests stub out. It signs a real RS256 assertion with a
    real key, so a jose/cryptography regression surfaces here rather than as a
    silent "no push" in production.
    """

    @pytest.fixture(autouse=True)
    def _clear_cache(self):
        push_service._cached_access_token = None
        push_service._cached_expiry = None
        yield
        push_service._cached_access_token = None
        push_service._cached_expiry = None

    @pytest.mark.asyncio
    async def test_exchanges_a_signed_assertion_for_a_token(self, monkeypatch):
        creds = _service_account()
        monkeypatch.setattr(push_service, "_load_service_account", lambda: creds)

        sent = []
        monkeypatch.setattr(
            push_service.httpx, "AsyncClient",
            lambda **kw: _FakeClient(
                _FakeResponse(200, {"access_token": "granted", "expires_in": 3600}), sent
            ),
        )

        assert await push_service._access_token() == "granted"

        posted = sent[0]["data"]
        assert posted["grant_type"] == push_service._JWT_GRANT
        claims = jwt.get_unverified_claims(posted["assertion"])
        assert claims["iss"] == creds["client_email"]
        assert claims["scope"] == push_service._SCOPE
        assert claims["aud"] == push_service._TOKEN_URI

    @pytest.mark.asyncio
    async def test_the_token_is_cached_between_sends(self, monkeypatch):
        creds = _service_account()
        monkeypatch.setattr(push_service, "_load_service_account", lambda: creds)

        sent = []
        monkeypatch.setattr(
            push_service.httpx, "AsyncClient",
            lambda **kw: _FakeClient(
                _FakeResponse(200, {"access_token": "granted", "expires_in": 3600}), sent
            ),
        )

        await push_service._access_token()
        await push_service._access_token()
        # Google rate-limits the exchange; one per hour, not one per notification.
        assert len(sent) == 1

    @pytest.mark.asyncio
    async def test_a_rejected_exchange_yields_no_token(self, monkeypatch):
        creds = _service_account()
        monkeypatch.setattr(push_service, "_load_service_account", lambda: creds)

        sent = []
        monkeypatch.setattr(
            push_service.httpx, "AsyncClient",
            lambda **kw: _FakeClient(
                _FakeResponse(400, {"error": "invalid_grant"}), sent
            ),
        )

        assert await push_service._access_token() is None

    @pytest.mark.asyncio
    async def test_an_expired_cache_is_refreshed(self, monkeypatch):
        creds = _service_account()
        monkeypatch.setattr(push_service, "_load_service_account", lambda: creds)

        sent = []
        monkeypatch.setattr(
            push_service.httpx, "AsyncClient",
            lambda **kw: _FakeClient(
                _FakeResponse(200, {"access_token": f"granted-{len(sent)}",
                                    "expires_in": 3600}), sent
            ),
        )

        await push_service._access_token()
        push_service._cached_expiry = push_service._now() - timedelta(seconds=1)
        await push_service._access_token()
        assert len(sent) == 2


class TestRegistration:
    @pytest.mark.asyncio
    async def test_registers_a_new_device(self, users):
        doc = await push_service.register_token(str(users["staff"].id), TOKEN)
        assert doc.user_id == str(users["staff"].id)
        assert doc.disabled_at is None
        assert await DeviceToken.find({"token": TOKEN}).count() == 1

    @pytest.mark.asyncio
    async def test_re_registering_does_not_duplicate(self, users):
        await push_service.register_token(str(users["staff"].id), TOKEN)
        await push_service.register_token(str(users["staff"].id), TOKEN)
        assert await DeviceToken.find({"token": TOKEN}).count() == 1

    @pytest.mark.asyncio
    async def test_a_second_user_takes_over_the_device(self, users):
        """A shift handover must not leave alerts arriving for the last user."""
        await push_service.register_token(str(users["staff"].id), TOKEN)
        await push_service.register_token(str(users["other"].id), TOKEN)

        assert await DeviceToken.find({"token": TOKEN}).count() == 1
        doc = await DeviceToken.find_one({"token": TOKEN})
        assert doc.user_id == str(users["other"].id)

    @pytest.mark.asyncio
    async def test_re_registering_revives_a_disabled_device(self, users):
        doc = await push_service.register_token(str(users["staff"].id), TOKEN)
        doc.disabled_at = push_service._now()
        doc.last_error = "UNREGISTERED"
        await doc.save()

        revived = await push_service.register_token(str(users["staff"].id), TOKEN)
        assert revived.disabled_at is None
        assert revived.last_error is None

    @pytest.mark.asyncio
    async def test_prune_removes_the_row(self, users):
        await push_service.register_token(str(users["staff"].id), TOKEN)
        await push_service.prune_token(TOKEN)
        assert await DeviceToken.find({"token": TOKEN}).count() == 0


class TestSummarise:
    def test_a_single_alert_keeps_its_own_wording(self):
        title, body, data = push_service._summarise([{
            "key": "water_quality_missing:2026-08-14",
            "type": "water_quality_missing",
            "severity": "critical",
            "title": "Water quality log missing",
            "message": "Tank 3 has no log for today",
            "link": "/staff/log-entry",
        }])
        assert title == "Water quality log missing"
        assert body == "Tank 3 has no log for today"
        assert data["link"] == "/staff/log-entry"
        assert data["severity"] == "critical"

    def test_several_alerts_collapse_into_one_digest(self):
        items = [
            {"key": f"k{i}", "type": "water_quality_missing", "severity": "warning",
             "title": f"Alert {i}", "message": "m", "link": "/staff/log-entry"}
            for i in range(4)
        ]
        title, body, data = push_service._summarise(items)
        assert title == "4 new ACARE alerts"
        assert body.endswith("…")
        assert data["key"] == "digest"
        assert data["link"] == "/staff/notifications"

    def test_a_digest_takes_the_worst_severity(self):
        items = [
            {"key": "a", "severity": "info", "title": "A", "message": "", "link": "/x"},
            {"key": "b", "severity": "critical", "title": "B", "message": "", "link": "/x"},
        ]
        _, _, data = push_service._summarise(items)
        assert data["severity"] == "critical"


class TestSending:
    @pytest.mark.asyncio
    async def test_sends_one_message_per_device(self, users, configured, monkeypatch):
        await push_service.register_token(str(users["staff"].id), TOKEN)
        await push_service.register_token(str(users["staff"].id), TOKEN + "-b")

        sent = []
        monkeypatch.setattr(
            push_service.httpx, "AsyncClient",
            lambda **kw: _FakeClient(_FakeResponse(200, {"name": "ok"}), sent),
        )

        result = await push_service.send_to_users({
            str(users["staff"].id): [{
                "key": "k", "type": "water_quality_missing", "severity": "critical",
                "title": "T", "message": "M", "link": "/staff/log-entry",
            }],
        })

        assert result["sent"] == 2
        assert result["failed"] == 0
        assert len(sent) == 2
        assert all("acare-test" in s["url"] for s in sent)

    @pytest.mark.asyncio
    async def test_the_message_carries_the_channel_and_a_collapse_tag(
        self, users, configured, monkeypatch
    ):
        """Android 8+ drops a message naming a channel the app never created."""
        await push_service.register_token(str(users["staff"].id), TOKEN)

        sent = []
        monkeypatch.setattr(
            push_service.httpx, "AsyncClient",
            lambda **kw: _FakeClient(_FakeResponse(200, {}), sent),
        )

        await push_service.send_to_users({
            str(users["staff"].id): [{
                "key": "quarantine_expiring:tank-3", "type": "quarantine_expiring",
                "severity": "warning", "title": "T", "message": "M",
                "link": "/staff/quarantine",
            }],
        })

        message = sent[0]["json"]["message"]
        assert message["token"] == TOKEN
        assert message["notification"] == {"title": "T", "body": "M"}
        assert message["android"]["priority"] == "high"
        assert message["android"]["notification"]["channel_id"] == (
            push_service.settings.FCM_ANDROID_CHANNEL_ID
        )
        # Collapsing on the key is what stops a re-sent alert stacking duplicates.
        assert message["android"]["notification"]["tag"] == "quarantine_expiring:tank-3"
        assert message["data"]["link"] == "/staff/quarantine"

    @pytest.mark.asyncio
    async def test_a_dead_token_is_disabled_not_deleted(self, users, configured, monkeypatch):
        await push_service.register_token(str(users["staff"].id), TOKEN)

        sent = []
        monkeypatch.setattr(
            push_service.httpx, "AsyncClient",
            lambda **kw: _FakeClient(
                _FakeResponse(404, {"error": {"status": "NOT_FOUND", "details": [
                    {"errorCode": "UNREGISTERED"}
                ]}}),
                sent,
            ),
        )

        result = await push_service.send_to_users({
            str(users["staff"].id): [
                {"key": "k", "type": "t", "severity": "info", "title": "T",
                 "message": "M", "link": "/x"}
            ],
        })

        assert result["disabled"] == 1
        doc = await DeviceToken.find_one({"token": TOKEN})
        assert doc is not None, "the row should survive so a re-register reuses it"
        assert doc.disabled_at is not None
        assert doc.last_error == "UNREGISTERED"

    @pytest.mark.asyncio
    async def test_a_transient_failure_leaves_the_device_alone(
        self, users, configured, monkeypatch
    ):
        """A 503 is FCM having a bad day, not a device that no longer exists."""
        await push_service.register_token(str(users["staff"].id), TOKEN)

        sent = []
        monkeypatch.setattr(
            push_service.httpx, "AsyncClient",
            lambda **kw: _FakeClient(
                _FakeResponse(503, {"error": {"status": "UNAVAILABLE"}}), sent
            ),
        )

        result = await push_service.send_to_users({
            str(users["staff"].id): [
                {"key": "k", "type": "t", "severity": "info", "title": "T",
                 "message": "M", "link": "/x"}
            ],
        })

        assert result["failed"] == 1
        assert result["disabled"] == 0
        doc = await DeviceToken.find_one({"token": TOKEN})
        assert doc.disabled_at is None

    @pytest.mark.asyncio
    async def test_a_disabled_device_is_skipped(self, users, configured, monkeypatch):
        doc = await push_service.register_token(str(users["staff"].id), TOKEN)
        doc.disabled_at = push_service._now()
        await doc.save()

        sent = []
        monkeypatch.setattr(
            push_service.httpx, "AsyncClient",
            lambda **kw: _FakeClient(_FakeResponse(200, {}), sent),
        )

        result = await push_service.send_to_users({
            str(users["staff"].id): [
                {"key": "k", "type": "t", "severity": "info", "title": "T",
                 "message": "M", "link": "/x"}
            ],
        })

        assert result["devices"] == 0
        assert sent == []

    @pytest.mark.asyncio
    async def test_unconfigured_push_is_a_no_op(self, users, monkeypatch):
        monkeypatch.setattr(push_service, "_load_service_account", lambda: None)
        await push_service.register_token(str(users["staff"].id), TOKEN)

        result = await push_service.send_to_users({
            str(users["staff"].id): [
                {"key": "k", "type": "t", "severity": "info", "title": "T",
                 "message": "M", "link": "/x"}
            ],
        })
        assert result["sent"] == 0
        assert result["skipped"] == "not_configured"

    @pytest.mark.asyncio
    async def test_a_user_with_no_device_is_simply_skipped(self, users, configured):
        result = await push_service.send_to_users({
            str(users["staff"].id): [
                {"key": "k", "type": "t", "severity": "info", "title": "T",
                 "message": "M", "link": "/x"}
            ],
        })
        assert result == {"sent": 0, "failed": 0, "devices": 0, "disabled": 0}


class TestSweepDispatch:
    @pytest.mark.asyncio
    async def test_only_newly_created_alerts_are_pushed(self, users, monkeypatch):
        """
        The countdown in a quarantine notice is rewritten every pass. Pushing a
        refreshed row would turn one condition into a buzz every sweep interval.
        """
        calls = []

        async def _capture(by_user):
            calls.append(by_user)
            return {"sent": 1, "failed": 0, "devices": 1, "disabled": 0}

        monkeypatch.setattr(push_service, "send_to_users", _capture)

        alerts = [{
            "user_id": str(users["staff"].id), "key": "k", "type": "t",
            "severity": "info", "title": "T", "message": "M", "link": "/x",
        }]
        await NotificationService._dispatch_push(alerts)
        assert len(calls) == 1
        assert list(calls[0]) == [str(users["staff"].id)]

        # Nothing new this pass — no send attempted at all.
        await NotificationService._dispatch_push([])
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_alerts_are_grouped_per_user(self, users, monkeypatch):
        calls = []

        async def _capture(by_user):
            calls.append(by_user)
            return {"sent": 0, "failed": 0, "devices": 0, "disabled": 0}

        monkeypatch.setattr(push_service, "send_to_users", _capture)

        await NotificationService._dispatch_push([
            {"user_id": str(users["staff"].id), "key": "a", "title": "A",
             "message": "", "link": "/x", "type": "t", "severity": "info"},
            {"user_id": str(users["staff"].id), "key": "b", "title": "B",
             "message": "", "link": "/x", "type": "t", "severity": "info"},
            {"user_id": str(users["other"].id), "key": "c", "title": "C",
             "message": "", "link": "/x", "type": "t", "severity": "info"},
        ])

        grouped = calls[0]
        assert len(grouped[str(users["staff"].id)]) == 2
        assert len(grouped[str(users["other"].id)]) == 1

    @pytest.mark.asyncio
    async def test_a_broken_fcm_does_not_fail_the_sweep(self, users, monkeypatch):
        """
        The feed row is already written when push runs. Letting an FCM outage
        propagate would abort the pass and leave the feed half-reconciled, which
        is worse than a phone that missed one buzz.
        """
        async def _explode(by_user):
            raise RuntimeError("FCM is down")

        monkeypatch.setattr(push_service, "send_to_users", _explode)

        result = await NotificationService._dispatch_push([
            {"user_id": str(users["staff"].id), "key": "a", "title": "A",
             "message": "", "link": "/x", "type": "t", "severity": "info"},
        ])
        assert result["sent"] == 0
        assert result["failed"] == 1

    @pytest.mark.asyncio
    async def test_the_full_sweep_reports_what_it_pushed(self, users, monkeypatch):
        async def _quiet(by_user):
            return {"sent": 0, "failed": 0, "devices": 0, "disabled": 0}

        monkeypatch.setattr(push_service, "send_to_users", _quiet)

        result = await NotificationService.sweep(force=True)
        assert "pushed" in result
        assert result["status"] == "completed"


class TestEndpoints:
    @pytest.mark.asyncio
    async def test_register_and_unregister_round_trip(self, users):
        from httpx import ASGITransport, AsyncClient

        from app.core.security import create_access_token
        from app.main import app

        token = create_access_token(str(users["staff"].id), users["staff"].role.value)
        headers = {"Authorization": f"Bearer {token}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post(
                "/notifications/devices", json={"token": TOKEN}, headers=headers
            )
            assert res.status_code == 200
            assert res.json()["registered"] is True
            assert await DeviceToken.find({"token": TOKEN}).count() == 1

            res = await client.delete(
                f"/notifications/devices?token={TOKEN}", headers=headers
            )
            assert res.status_code == 200
            assert await DeviceToken.find({"token": TOKEN}).count() == 0

    @pytest.mark.asyncio
    async def test_registration_requires_a_signed_in_user(self, users):
        from httpx import ASGITransport, AsyncClient

        from app.main import app

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post("/notifications/devices", json={"token": TOKEN})
        assert res.status_code in (401, 403)
        assert await DeviceToken.find({"token": TOKEN}).count() == 0

    @pytest.mark.asyncio
    async def test_an_empty_token_is_rejected(self, users):
        from httpx import ASGITransport, AsyncClient

        from app.core.security import create_access_token
        from app.main import app

        token = create_access_token(str(users["staff"].id), users["staff"].role.value)
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post(
                "/notifications/devices",
                json={"token": ""},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 422
