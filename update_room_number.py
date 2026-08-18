import asyncio
import os
import sys
import argparse
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.getcwd(), 'apps', 'api'))

from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from app.models.facility import Room, Facility

async def update_room(mongo_uri: str, db_name: str, target_room_number: str = "1"):
    print(f"Connecting to MongoDB at: {mongo_uri}")
    print(f"Target Database: {db_name}")
    
    client = AsyncIOMotorClient(mongo_uri)
    db = client[db_name]
    
    await init_beanie(database=db, document_models=[Facility, Room])
    
    rooms = await Room.find_all().to_list()
    if not rooms:
        print("No rooms found in database.")
        return

    updated_count = 0
    for room in rooms:
        old_num = room.room_number
        room.room_number = target_room_number
        await room.save()
        print(f"Updated Room ID {room.id}: '{old_num}' -> '{target_room_number}'")
        updated_count += 1
        
    print(f"\nSuccessfully updated {updated_count} room(s) to Room Number '{target_room_number}'.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Update ACARE Room Number in local or MongoDB Atlas Cloud database.")
    parser.add_argument("--uri", type=str, help="MongoDB connection string (e.g. mongodb+srv://... for Atlas)")
    parser.add_argument("--db", type=str, help="Database name (e.g. acare-mvp or uwindsor-accs-prod)")
    parser.add_argument("--room", type=str, default="1", help="Target room number (default: '1')")
    
    args = parser.parse_args()
    
    load_dotenv(os.path.join('apps', 'api', '.env'))
    
    mongo_uri = args.uri or os.getenv("MONGO_URI", "mongodb://localhost:27017")
    db_name = args.db or os.getenv("MONGODB_DB_NAME", "acare-mvp")
    
    asyncio.run(update_room(mongo_uri, db_name, args.room))
