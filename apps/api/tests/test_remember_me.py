import pytest
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.config import settings
from app.core.security import decode_access_token
from app.db import init_db

SUPERADMIN = {"email": "superadmin@uwindsor.ca", "password": "ChangeMe123!"}


def _hours_until_expiry(token: str) -> float:
    exp = datetime.fromtimestamp(decode_access_token(token)["exp"], tz=timezone.utc)
    return (exp - datetime.now(timezone.utc)).total_seconds() / 3600


@pytest.mark.asyncio
async def test_remember_me_controls_token_lifetime():
    """The checkbox is only meaningful if it actually changes the JWT's exp.

    A frontend-only "remember me" would still be capped by the 12h token, so
    this asserts the two lifetimes really do differ and that the cookie the
    login sets never outlives the token it carries.
    """
    await init_db()
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Omitting remember_me must keep the old short-lived behaviour, so
        # existing clients that never send the field are unaffected.
        default_res = await ac.post("/auth/login", json=SUPERADMIN)
        assert default_res.status_code == 200
        default_hours = _hours_until_expiry(default_res.json()["access_token"])
        assert default_hours == pytest.approx(settings.ACCESS_TOKEN_EXPIRE_HOURS, abs=1)

        short_res = await ac.post("/auth/login", json={**SUPERADMIN, "remember_me": False})
        assert short_res.status_code == 200
        short_hours = _hours_until_expiry(short_res.json()["access_token"])
        assert short_hours == pytest.approx(settings.ACCESS_TOKEN_EXPIRE_HOURS, abs=1)

        long_res = await ac.post("/auth/login", json={**SUPERADMIN, "remember_me": True})
        assert long_res.status_code == 200
        long_hours = _hours_until_expiry(long_res.json()["access_token"])
        assert long_hours == pytest.approx(settings.REMEMBER_ME_EXPIRE_DAYS * 24, abs=1)

        assert long_hours > short_hours

        # The cookie must expire with the token, not on the old fixed 12h.
        cookie = long_res.headers.get("set-cookie", "")
        assert f"Max-Age={settings.REMEMBER_ME_EXPIRE_DAYS * 24 * 3600}" in cookie


@pytest.mark.asyncio
async def test_remembered_token_is_accepted():
    """A long-lived token must still authenticate — the claims are unchanged."""
    await init_db()
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post("/auth/login", json={**SUPERADMIN, "remember_me": True})
        assert res.status_code == 200
        token = res.json()["access_token"]

        me = await ac.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["email"] == SUPERADMIN["email"]
