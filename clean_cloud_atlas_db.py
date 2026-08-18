import asyncio
import os
import sys
import argparse
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.getcwd(), 'apps', 'api'))

from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from app.models.facility import Facility, Room, Tank

async def clean_cloud_db(mongo_uri: str, db_name: str):
    print(f"Connecting to MongoDB at: {mongo_uri}")
    print(f"Target Database: {db_name}")
    
    kwargs = {}
    if "mongodb+srv://" in mongo_uri or "ssl=true" in mongo_uri.lower() or "tls=true" in mongo_uri.lower():
        import certifi
        kwargs["tlsCAFile"] = certifi.where()

    client = AsyncIOMotorClient(mongo_uri, **kwargs)
    db = client[db_name]
    
    await init_beanie(database=db, document_models=[Facility, Room, Tank])
    
    # 1. Ensure primary LaSalle Facility
    fac = await Facility.find_one({"name": "LaSalle Freshwater Restoration Ecology Centre"})
    if not fac:
        facs = await Facility.find_all().to_list()
        if facs:
            fac = facs[0]
            fac.name = "LaSalle Freshwater Restoration Ecology Centre"
            fac.address = "LaSalle, ON"
            await fac.save()
        else:
            fac = Facility(
                name="LaSalle Freshwater Restoration Ecology Centre",
                address="LaSalle, ON",
                description="Main restoration ecology facility"
            )
            await fac.insert()
            
    print(f"Primary Facility: ID={fac.id}, Name='{fac.name}'")

    # 2. Consolidate Rooms to Room '1'
    rooms = await Room.find({"facility_id": str(fac.id)}).to_list()
    if not rooms:
        all_rooms = await Room.find_all().to_list()
        if all_rooms:
            rooms = all_rooms
            for r in rooms:
                r.facility_id = str(fac.id)
                await r.save()
        else:
            r = Room(facility_id=str(fac.id), room_number="1", description="Main aquatic holding room")
            await r.insert()
            rooms = [r]

    primary_room = rooms[0]
    for r in rooms:
        if str(r.room_number) == "1" or str(r.room_number) == "301":
            primary_room = r
            break

    primary_room.room_number = "1"
    primary_room.facility_id = str(fac.id)
    await primary_room.save()
    print(f"Primary Room: ID={primary_room.id}, Room Number='{primary_room.room_number}'")

    # Delete secondary rooms & move or clean their tanks
    for r in rooms:
        if str(r.id) != str(primary_room.id):
            print(f"Cleaning up secondary Room ID={r.id} (Room Number '{r.room_number}')")
            tanks_in_room = await Tank.find({"room_id": str(r.id)}).to_list()
            for t in tanks_in_room:
                # Check if tank number already exists in primary room
                existing_in_primary = await Tank.find_one({"room_id": str(primary_room.id), "tank_number": t.tank_number, "deleted": False})
                if existing_in_primary:
                    await t.delete()
                    print(f"  Deleted duplicate Tank {t.tank_number} (ID={t.id})")
                else:
                    t.room_id = str(primary_room.id)
                    await t.save()
                    print(f"  Moved Tank {t.tank_number} to Primary Room")
            await r.delete()

    # 3. Clean up any remaining duplicate tanks in primary room
    tanks = await Tank.find({"room_id": str(primary_room.id), "deleted": False}).to_list()
    seen = {}
    for t in sorted(tanks, key=lambda x: int(x.tank_number) if str(x.tank_number).isdigit() else 999):
        num = str(t.tank_number)
        if num in seen:
            print(f"Deleting duplicate Tank {num} (ID={t.id})")
            await t.delete()
        else:
            seen[num] = t

    remaining_tanks = await Tank.find({"deleted": False}).to_list()
    print(f"\n[OK] Migration & Cleanup Completed on '{db_name}'. Total Active Tanks: {len(remaining_tanks)}")
    for t in sorted(remaining_tanks, key=lambda x: int(x.tank_number) if str(x.tank_number).isdigit() else 999):
        print(f"  • Tank {t.tank_number:<3} | ID: {t.id} | RoomID: {t.room_id} | Status: {t.status}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clean and migrate MongoDB Atlas Cloud or Local database for ACARE.")
    parser.add_argument("--uri", type=str, help="MongoDB connection string (e.g., mongodb+srv://... for Atlas)")
    parser.add_argument("--db", type=str, help="Database name (e.g. acare-mvp or uwindsor-accs-prod)")
    
    args = parser.parse_args()
    load_dotenv(os.path.join('apps', 'api', '.env'))
    
    mongo_uri = args.uri or os.getenv("MONGO_URI", "mongodb://localhost:27017")
    db_name = args.db or os.getenv("MONGODB_DB_NAME", "acare-mvp")
    
    asyncio.run(clean_cloud_db(mongo_uri, db_name))
