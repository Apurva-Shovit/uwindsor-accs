import asyncio
from app.db import init_db
from app.models.user import User, RoleEnum, StatusEnum
from app.core.security import hash_password

from app.models.facility import Facility, Room, Tank

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
        print("Super admin already exists.")

    # 2. Seed Facility
    fac = await Facility.find_one({"name": "Windsor Aquatic Research Centre"})
    if not fac:
        fac = Facility(name="Windsor Aquatic Research Centre", address="401 Sunset Ave, Windsor, ON", description="Main pilot research facility")
        await fac.insert()
        print(f"Facility created: {fac.name} ({fac.id})")
    else:
        print("Facility already exists.")

    # 3. Seed Room
    room = await Room.find_one({"facility_id": str(fac.id), "room_number": "301"})
    if not room:
        room = Room(facility_id=str(fac.id), room_number="301", description="Main aquatic holding room")
        await room.insert()
        print(f"Room created: {room.room_number} ({room.id})")
    else:
        print("Room already exists.")

    # 4. Seed 14 Tanks
    tanks_created = 0
    for i in range(1, 15):
        t_num = str(i)
        t = await Tank.find_one({"room_id": str(room.id), "tank_number": t_num})
        if not t:
            t = Tank(room_id=str(room.id), tank_number=t_num, status="active", notes=f"Seeded Tank {t_num}")
            await t.insert()
            tanks_created += 1
    if tanks_created > 0:
        print(f"Seeded {tanks_created} new tanks.")
    else:
        print("All 14 pilot tanks already exist.")

if __name__ == "__main__":
    asyncio.run(seed())
