import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.models.user import User, RoleEnum
from app.models.facility import Facility, Room, Tank
from app.db import init_db

@pytest.mark.asyncio
async def test_sprint1_backend_flows():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Get dynamic user tokens
        su_login = await ac.post("/auth/login", json={"email": "superadmin@uwindsor.ca", "password": "ChangeMe123!"})
        su_token = su_login.json()["access_token"]

        # Register and approve a pilot staff user
        staff_signup = await ac.post("/auth/signup", json={
            "email": "staff_sprint1@uwindsor.ca",
            "password": "Password123!",
            "first_name": "Staff",
            "last_name": "Sprint1",
            "requested_role": "staff"
        })
        staff_id = staff_signup.json()["id"]

        # Approve the staff member, assigning a subset of tanks (e.g. Tank 1, Tank 2)
        all_tanks = await Tank.find({"deleted": False}).to_list()
        assert len(all_tanks) >= 14
        assigned_tanks = [str(all_tanks[0].id), str(all_tanks[1].id)]

        approve_res = await ac.patch(f"/users/{staff_id}/approve", json={
            "role": "staff",
            "assigned_tank_ids": assigned_tanks
        }, headers={"Authorization": f"Bearer {su_token}"})
        assert approve_res.status_code == 200

        # Login as Staff
        staff_login = await ac.post("/auth/login", json={"email": "staff_sprint1@uwindsor.ca", "password": "Password123!"})
        staff_token = staff_login.json()["access_token"]

        # 1. Staff accesses /tanks/summary -> should only return the 2 assigned tanks
        staff_summary = await ac.get("/facilities-structure/tanks/summary", headers={"Authorization": f"Bearer {staff_token}"})
        assert staff_summary.status_code == 200
        assert len(staff_summary.json()) == 2
        returned_ids = [t["id"] for t in staff_summary.json()]
        assert all(rid in assigned_tanks for rid in returned_ids)

        # 2. Super admin accesses /tanks/summary -> returns all 14+ tanks
        su_summary = await ac.get("/facilities-structure/tanks/summary", headers={"Authorization": f"Bearer {su_token}"})
        assert su_summary.status_code == 200
        assert len(su_summary.json()) >= 14

        # 3. Staff attempts POST /tanks -> 403 Forbidden
        staff_post_tank = await ac.post("/facilities-structure/tanks", json={
            "room_id": str(all_tanks[0].room_id),
            "tank_number": "99"
        }, headers={"Authorization": f"Bearer {staff_token}"})
        assert staff_post_tank.status_code == 403

        # 4. Super admin POST /tanks -> 201 Created
        su_post_tank = await ac.post("/facilities-structure/tanks", json={
            "room_id": str(all_tanks[0].room_id),
            "tank_number": "15",
            "notes": "Admin-created test tank"
        }, headers={"Authorization": f"Bearer {su_token}"})
        assert su_post_tank.status_code == 201
        new_tank_id = su_post_tank.json()["_id"]

        # Toggle state
        toggle_res = await ac.patch(f"/facilities-structure/tanks/{new_tank_id}", json={"status": "inactive"}, headers={"Authorization": f"Bearer {su_token}"})
        assert toggle_res.status_code == 200
        assert toggle_res.json()["status"] == "inactive"

        print("\nALL SPRINT 1 BACKEND VERIFICATIONS SUCCESSFUL!")
