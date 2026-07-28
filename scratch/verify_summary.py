import sys, os
sys.path.insert(0, os.path.abspath('.'))
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from apps.api.app.config import settings

async def verify_timeline():
    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGODB_DB_NAME]
    
    users = await db['users'].find().to_list(10)
    print('=== USERS ===')
    for u in users:
        print(f"  {u.get('email')} | role: {u.get('role')} | status: {u.get('status')}")
        
    projects = await db['projects'].find().to_list(10)
    print('\n=== PROJECTS ===')
    for p in projects:
        print(f"  {p.get('title')} | PI: {p.get('pi_name')} | Est: {p.get('established_date')} | Exp: {p.get('aupp_expiry_date')}")

    tanks = await db['tanks'].find().to_list(20)
    print('\n=== TANKS ===')
    for t in tanks:
        if t.get('tank_number') in ['1', '2', '3']:
            print(f"  Tank {t.get('tank_number')} | quarantined: {t.get('is_quarantined')} | notes: {t.get('notes')}")

    assignments = await db['tank_assignments'].find().to_list(10)
    print('\n=== TANK ASSIGNMENTS ===')
    for a in assignments:
        print(f"  Tank ID {a.get('tank_id')} | count: {a.get('current_count')}")

    incidents = await db['incident_reports'].find().to_list(10)
    print(f'\n=== INCIDENT REPORTS: {len(incidents)} ===')

    census = await db['census_events'].find().to_list(20)
    print(f'\n=== CENSUS EVENTS: {len(census)} ===')
    for c in census:
        print(f"  {c.get('date')} | {c.get('event_type')} | change: {c.get('change')} | reason: {c.get('reason')}")

    wq_count = await db['water_quality_logs'].count_documents({})
    print(f'\n=== WATER QUALITY LOGS COUNT: {wq_count} ===')

if __name__ == '__main__':
    asyncio.run(verify_timeline())
