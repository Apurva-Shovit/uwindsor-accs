import asyncio
from app.db import init_db, ensure_baseline_facility
from app.models.user import User, RoleEnum, StatusEnum
from app.core.security import hash_password

from app.models.facility import Tank

async def seed():
    await init_db()
    
    # 1. Seed Super Admin
    existing = await User.find_one({"email": "superadmin@uwindsor.ca"})
    if not existing:
        su = User(
            email="superadmin@uwindsor.ca",
            password_hash=hash_password("ChangeMe123!"),
            first_name="Super",
            last_name="Admin",
            requested_role=RoleEnum.super_admin,
            role=RoleEnum.super_admin,
            status=StatusEnum.active,
        )
        await su.insert()
        print("Super admin created: superadmin@uwindsor.ca / ChangeMe123!")
    else:
        existing.password_hash = hash_password("ChangeMe123!")
        await existing.save()
        print("Super admin password reset to ChangeMe123!")

    # 2. Seed the baseline facility, room, and 14 tanks.
    # Shared with init_db so there is a single definition of the baseline: the
    # copy that used to live here still looked the pilot room up by number
    # ("301"), so once the room was renamed to "1" every boot seeded a second
    # room and a duplicate set of 14 tanks.
    fac, room = await ensure_baseline_facility()
    print(f"Facility ready: {fac.name} ({fac.id})")
    print(f"Room ready: {room.room_number} ({room.id})")
    tank_count = await Tank.find({"room_id": str(room.id), "deleted": False}).count()
    print(f"Room {room.room_number} has {tank_count} active tanks.")

if __name__ == "__main__":
    asyncio.run(seed())
