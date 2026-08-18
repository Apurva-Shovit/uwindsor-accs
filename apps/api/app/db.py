from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from .config import settings
from .models.user import User
from .models.audit_log import AuditLog
from .models.species import Species
from .models.facility import Facility, Room, Tank
from .models.water_quality_log import WaterQualityLog
from .models.incident_report import IncidentReport
from .models.project import Project
from .models.tank_assignment import TankAssignment
from .models.census_event import CensusEvent
from .models.individual_fish import IndividualFish
from .models.quarantine import QuarantineExemption
from .models.notification import Notification, NotificationSettings, NotificationSweepState
from .models.device_token import DeviceToken

import certifi

async def init_db():
    kwargs = {}
    if "mongodb+srv://" in settings.MONGO_URI or "ssl=true" in settings.MONGO_URI.lower() or "tls=true" in settings.MONGO_URI.lower():
        kwargs["tlsCAFile"] = certifi.where()
    client = AsyncIOMotorClient(settings.MONGO_URI, **kwargs)
    await init_beanie(
        database=client[settings.MONGODB_DB_NAME],
        document_models=[
            User, AuditLog, Facility, Room, Tank,
            WaterQualityLog, IncidentReport, Project,
            TankAssignment, CensusEvent, Species,
            IndividualFish, QuarantineExemption,
            Notification, NotificationSettings, NotificationSweepState,
            DeviceToken,
        ],
    )
    # Ensure superadmin account exists with known password
    from .core.security import hash_password
    from .models.user import RoleEnum, StatusEnum
    su = await User.find_one({"email": "superadmin@uwindsor.ca"})
    if not su:
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
    else:
        changed = False
        if su.role != RoleEnum.super_admin:
            su.role = RoleEnum.super_admin
            changed = True
        if su.status != StatusEnum.active:
            su.status = StatusEnum.active
            changed = True
        if changed:
            await su.save()

    # Ensure baseline facility, room, and 14 tanks exist
    fac = await Facility.find_one({"name": "LaSalle Freshwater Restoration Ecology Centre"})
    if not fac:
        fac = Facility(name="LaSalle Freshwater Restoration Ecology Centre", address="LaSalle, ON", description="Main restoration ecology facility")
        await fac.insert()
        
    room = await Room.find_one({"facility_id": str(fac.id), "room_number": "1"})
    if not room:
        room = await Room.find_one({"facility_id": str(fac.id)})
    if not room:
        room = Room(facility_id=str(fac.id), room_number="1", description="Main aquatic holding room")
        await room.insert()
    elif room.room_number != "1":
        room.room_number = "1"
        await room.save()

    existing_tanks = await Tank.find({"room_id": str(room.id)}).to_list()
    if len(existing_tanks) < 14:
        for i in range(1, 15):
            t_num = str(i)
            t = await Tank.find_one({"room_id": str(room.id), "tank_number": t_num})
            if not t:
                t = Tank(room_id=str(room.id), tank_number=t_num, status="active", notes=f"Seeded Tank {t_num}")
                await t.insert()



