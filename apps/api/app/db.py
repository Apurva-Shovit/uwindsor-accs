from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from .config import settings
from .models.user import User, AuditLog
from .models.species import Species
from .models.facility import Facility, Room, Tank
from .models.water_quality_log import WaterQualityLog
from .models.incident_report import IncidentReport
from .models.project import Project
from .models.tank_assignment import TankAssignment
from .models.census_event import CensusEvent
from .models.individual_fish import IndividualFish
from .models.quarantine import QuarantineExemption

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
            IndividualFish, QuarantineExemption
        ],
    )

