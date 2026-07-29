import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.models.user import User
from app.models.audit_log import AuditLog
from app.core.security import create_access_token, hash_password

from app.db import init_db

@pytest.mark.asyncio
async def test_full_auth_approval_flow():
    await init_db()
    # Clean up test accounts to ensure isolation
    test_emails = ["chair_test@uwindsor.ca", "staff_test@uwindsor.ca", "another_chair@uwindsor.ca"]
    await User.find({"email": {"$in": test_emails}}).delete()
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. Health check
        res = await ac.get("/health")
        assert res.status_code == 200


        # 2. Super admin login
        su = await User.find_one({"email": "superadmin@uwindsor.ca"})
        assert su is not None
        login_res = await ac.post("/auth/login", json={"email": "superadmin@uwindsor.ca", "password": "ChangeMe123!"})
        assert login_res.status_code == 200
        su_token = login_res.json()["access_token"]

        # 3. Chair signup
        signup_res = await ac.post("/auth/signup", json={
            "email": "chair_test@uwindsor.ca",
            "password": "Password123!",
            "first_name": "Chair",
            "last_name": "User",
            "requested_role": "chair"
        })
        assert signup_res.status_code == 201
        chair_id = signup_res.json()["id"]

        # Attempt chair login before approval -> 403
        chair_login_fail = await ac.post("/auth/login", json={"email": "chair_test@uwindsor.ca", "password": "Password123!"})
        assert chair_login_fail.status_code == 403

        # 4. Super Admin lists pending users
        pending_res = await ac.get("/users/pending", headers={"Authorization": f"Bearer {su_token}"})
        assert pending_res.status_code == 200
        pending_ids = [u["id"] for u in pending_res.json()]
        assert chair_id in pending_ids

        # 5. Super Admin approves Chair
        approve_res = await ac.patch(f"/users/{chair_id}/approve", json={"role": "chair"}, headers={"Authorization": f"Bearer {su_token}"})
        assert approve_res.status_code == 200

        # Chair can now log in
        chair_login_ok = await ac.post("/auth/login", json={"email": "chair_test@uwindsor.ca", "password": "Password123!"})
        assert chair_login_ok.status_code == 200
        chair_token = chair_login_ok.json()["access_token"]

        # 6. Staff signup
        staff_signup = await ac.post("/auth/signup", json={
            "email": "staff_test@uwindsor.ca",
            "password": "Password123!",
            "first_name": "Staff",
            "last_name": "User",
            "requested_role": "staff"
        })
        assert staff_signup.status_code == 201
        staff_id = staff_signup.json()["id"]

        # 7. Chair attempts illegal approval of another Chair -> 403
        another_chair_signup = await ac.post("/auth/signup", json={
            "email": "another_chair@uwindsor.ca",
            "password": "Password123!",
            "first_name": "Another",
            "last_name": "Chair",
            "requested_role": "chair"
        })
        another_chair_id = another_chair_signup.json()["id"]

        illegal_approve = await ac.patch(f"/users/{another_chair_id}/approve", json={"role": "chair"}, headers={"Authorization": f"Bearer {chair_token}"})
        assert illegal_approve.status_code == 403

        # 8. Chair approves Staff -> 200
        staff_approve = await ac.patch(f"/users/{staff_id}/approve", json={"role": "staff"}, headers={"Authorization": f"Bearer {chair_token}"})
        assert staff_approve.status_code == 200

        # 9. Audit log entries check
        logs = await AuditLog.find({}).to_list()
        actions = [l.action for l in logs]
        assert "user_signup" in actions
        assert "login" in actions
        assert "user_approve" in actions

        print("\nALL ACCEPTANCE TESTS PASSED SUCCESSFULLY!")
