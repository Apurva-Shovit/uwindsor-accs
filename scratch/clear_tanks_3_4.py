import sys
import os
import asyncio
from datetime import date
from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient
import certifi

sys.path.insert(0, os.path.abspath("apps/api"))

from app.config import settings
from app.models.facility import Tank, Room, Facility
from app.models.project import Project
from app.models.tank_assignment import TankAssignment
from app.models.census_event import CensusEvent
from app.models.user import User

async def main():
    kwargs = {}
    if "mongodb+srv://" in settings.MONGO_URI or "ssl=true" in settings.MONGO_URI.lower() or "tls=true" in settings.MONGO_URI.lower():
        kwargs["tlsCAFile"] = certifi.where()
    client = AsyncIOMotorClient(settings.MONGO_URI, **kwargs)
    db = client[settings.MONGODB_DB_NAME]
    await init_beanie(
        database=db,
        document_models=[Tank, Room, Facility, Project, TankAssignment, CensusEvent, User]
    )

    tanks = await Tank.find({"tank_number": {"$in": ["3", "4"]}}).to_list()
    print(f"Found {len(tanks)} tanks with numbers 3 & 4.")

    for tank in tanks:
        print(f"\nProcessing Tank {tank.tank_number} (ID: {tank.id})...")
        assignments = await TankAssignment.find({
            "tank_id": str(tank.id),
            "current_count": {"$gt": 0}
        }).to_list()

        if not assignments:
            assignments = await TankAssignment.find({"tank_id": str(tank.id)}).to_list()

        for ta in assignments:
            count = ta.current_count
            if count > 0:
                print(f"  Clearing {count} fish from Assignment {ta.id} (Project: {ta.project_id})...")
                ev = CensusEvent(
                    tank_id=str(tank.id),
                    tank_assignment_id=str(ta.id),
                    project_id=str(ta.project_id),
                    event_type="death",
                    change=-count,
                    reason="Mortality / Manual Clearing",
                    notes="Fish marked dead to clear tank per user request",
                    date=date.today(),
                    created_by=str(ta.created_by or "system")
                )
                await ev.insert()
                ta.current_count = 0
                await ta.save()
                print("  Logged death CensusEvent and updated current_count to 0.")

        tank.status = "empty"
        tank.is_quarantined = False
        tank.quarantine_start_date = None
        tank.quarantine_end_date = None
        await tank.save()
        print(f"Tank {tank.tank_number} status set to 'empty'.")

    print("\nSuccessfully cleared Tanks 3 and 4.")

if __name__ == "__main__":
    asyncio.run(main())
