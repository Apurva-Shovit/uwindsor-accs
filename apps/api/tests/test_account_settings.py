import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db import init_db
from app.models.user import User, RoleEnum, StatusEnum
from app.core.security import hash_password

@pytest.mark.asyncio
async def test_change_password_and_email_flow():
    await init_db()
    transport = ASGITransport(app=app)

    user = User(
        email="acc_settings_test@uwindsor.ca",
        password_hash=hash_password("OldPass123!"),
        first_name="Account",
        last_name="Tester",
        requested_role=RoleEnum.staff,
        role=RoleEnum.staff,
        status=StatusEnum.active,
    )
    await user.insert()

    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Login
        login_res = await ac.post("/auth/login", json={"email": "acc_settings_test@uwindsor.ca", "password": "OldPass123!"})
        assert login_res.status_code == 200
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Check me
        me_res = await ac.get("/auth/me", headers=headers)
        assert me_res.status_code == 200
        assert me_res.json()["email"] == "acc_settings_test@uwindsor.ca"

        # Change password wrong old pass -> 400
        bad_pw = await ac.post("/auth/change-password", json={
            "old_password": "WrongPass123!",
            "new_password": "NewPass123!",
            "confirm_password": "NewPass123!",
        }, headers=headers)
        assert bad_pw.status_code == 400

        # Change password success
        ok_pw = await ac.post("/auth/change-password", json={
            "old_password": "OldPass123!",
            "new_password": "NewPass123!",
            "confirm_password": "NewPass123!",
        }, headers=headers)
        assert ok_pw.status_code == 200

        # Verify login with new password
        login_new = await ac.post("/auth/login", json={"email": "acc_settings_test@uwindsor.ca", "password": "NewPass123!"})
        assert login_new.status_code == 200
        token2 = login_new.json()["access_token"]
        headers2 = {"Authorization": f"Bearer {token2}"}

        # Change email wrong pass -> 400
        bad_email = await ac.post("/auth/change-email", json={
            "new_email": "acc_settings_new@uwindsor.ca",
            "current_password": "WrongPass123!",
        }, headers=headers2)
        assert bad_email.status_code == 400

        # Change email success
        ok_email = await ac.post("/auth/change-email", json={
            "new_email": "acc_settings_new@uwindsor.ca",
            "current_password": "NewPass123!",
        }, headers=headers2)
        assert ok_email.status_code == 200
        assert ok_email.json()["email"] == "acc_settings_new@uwindsor.ca"

        # Verify me reflects new email
        me_new = await ac.get("/auth/me", headers=headers2)
        assert me_new.status_code == 200
        assert me_new.json()["email"] == "acc_settings_new@uwindsor.ca"
