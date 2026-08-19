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
from .models.app_bundle import AppBundle

import certifi
import logging

logger = logging.getLogger(__name__)

# Indexes that an earlier version of a model created and that the current
# definition supersedes. Mongo refuses to redefine an index in place -- asking
# for {tank_id, project_id} as unique when a non-unique index of that name
# already exists fails with IndexKeySpecsConflict, and because init_beanie
# builds indexes during startup that failure takes the whole API down rather
# than surfacing as a warning. Dropping them first is what makes the upgrade
# survivable on a database that already holds data.
SUPERSEDED_INDEXES = {
    "tank_assignments": [
        # Replaced by the same key pattern with unique=True.
        "tank_id_1_project_id_1",
        # Replaced by the partial unique index on tank_id alone, which serves
        # the same {tank_id, current_count: {$gt: 0}} lookups.
        "tank_id_1_current_count_-1",
    ],
}


async def drop_superseded_indexes(database) -> None:
    """Remove indexes whose definition has changed, so init_beanie can rebuild them.

    Idempotent: a name that is already gone is skipped, so this is a no-op on
    every boot after the first.
    """
    for collection_name, index_names in SUPERSEDED_INDEXES.items():
        collection = database[collection_name]
        try:
            existing = await collection.index_information()
        except Exception:
            continue  # collection does not exist yet on a fresh database

        for name in index_names:
            spec = existing.get(name)
            if spec is None:
                continue
            # Only drop the old shape. Once the index has been rebuilt with the
            # new options, leave it alone.
            if name == "tank_id_1_project_id_1" and spec.get("unique"):
                continue
            await collection.drop_index(name)
            logger.info("Dropped superseded index %s.%s", collection_name, name)


async def init_db():
    kwargs = {}
    if "mongodb+srv://" in settings.MONGO_URI or "ssl=true" in settings.MONGO_URI.lower() or "tls=true" in settings.MONGO_URI.lower():
        kwargs["tlsCAFile"] = certifi.where()
    client = AsyncIOMotorClient(settings.MONGO_URI, **kwargs)
    await drop_superseded_indexes(client[settings.MONGODB_DB_NAME])
    await init_beanie(
        database=client[settings.MONGODB_DB_NAME],
        document_models=[
            User, AuditLog, Facility, Room, Tank,
            WaterQualityLog, IncidentReport, Project,
            TankAssignment, CensusEvent, Species,
            IndividualFish, QuarantineExemption,
            Notification, NotificationSettings, NotificationSweepState,
            DeviceToken, AppBundle,
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

    await ensure_baseline_facility()


BASELINE_FACILITY_NAME = "LaSalle Freshwater Restoration Ecology Centre"
BASELINE_ROOM_NUMBER = "1"
BASELINE_TANK_COUNT = 14


async def ensure_baseline_facility() -> tuple[Facility, Room]:
    """Ensure the pilot facility, its holding room, and its 14 tanks exist.

    This runs on every boot, so it matches the room by facility rather than by
    room number: the pilot room has been renamed once already (from "301" to
    "1"), and a number-only lookup treats a renamed room as missing and seeds a
    second room plus a second set of 14 tanks. Anything that needs the baseline
    room must come through here for the same reason.
    """
    fac = await Facility.find_one({"name": BASELINE_FACILITY_NAME})
    if not fac:
        fac = Facility(
            name=BASELINE_FACILITY_NAME,
            address="LaSalle, ON",
            description="Main restoration ecology facility",
        )
        await fac.insert()

    room = await Room.find_one(
        {"facility_id": str(fac.id), "room_number": BASELINE_ROOM_NUMBER, "deleted": False}
    )
    if not room:
        # Oldest surviving room wins, so repeated boots always settle on the
        # same room no matter what it has been renamed to.
        rooms = await Room.find({"facility_id": str(fac.id), "deleted": False}).sort("+_id").limit(1).to_list()
        room = rooms[0] if rooms else None
    if not room:
        room = Room(
            facility_id=str(fac.id),
            room_number=BASELINE_ROOM_NUMBER,
            description="Main aquatic holding room",
        )
        await room.insert()

    # Soft-deleted tanks count as present: they were retired on purpose and
    # must not be resurrected on the next boot.
    existing = await Tank.find({"room_id": str(room.id)}).to_list()
    if len(existing) < BASELINE_TANK_COUNT:
        present = {t.tank_number for t in existing}
        for i in range(1, BASELINE_TANK_COUNT + 1):
            t_num = str(i)
            if t_num in present:
                continue
            await Tank(
                room_id=str(room.id),
                tank_number=t_num,
                status="active",
                notes=f"Seeded Tank {t_num}",
            ).insert()

    return fac, room
