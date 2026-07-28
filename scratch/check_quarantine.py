import sys, os
sys.path.insert(0, os.path.abspath('.'))
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from apps.api.app.config import settings

async def check_quarantine():
    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGODB_DB_NAME]
    
    print(f"=== CHECKING QUARANTINE RECORDS IN {settings.MONGODB_DB_NAME} ===\n")
    
    # 1. Check Tanks
    tanks = await db['tanks'].find().to_list(100)
    print("1. TANKS QUARANTINE STATE:")
    quarantined_tanks = []
    quarantine_history_tanks = []
    for t in tanks:
        is_q = t.get('is_quarantined', False)
        q_start = t.get('quarantine_start_date')
        q_end = t.get('quarantine_end_date')
        notes = t.get('notes')
        if is_q or q_start or q_end:
            quarantined_tanks.append(t)
            print(f"  - Tank {t.get('tank_number')} (ID: {t.get('_id')})")
            print(f"    is_quarantined: {is_q}")
            print(f"    start_date:     {q_start}")
            print(f"    end_date:       {q_end}")
            print(f"    notes:          {notes}\n")
    if not quarantined_tanks:
        print("  None currently under active quarantine flag in tanks collection.\n")

    # 2. Check Quarantine Exemptions collection
    exemptions = await db['quarantine_exemptions'].find().to_list(100)
    print(f"2. QUARANTINE EXEMPTIONS COLLECTION ({len(exemptions)} records):")
    for ex in exemptions:
        print(f"  - Exemption ID: {ex.get('_id')} | Tank ID: {ex.get('tank_id')} | Granted By: {ex.get('granted_by')} | Reason: {ex.get('reason')}")
    if not exemptions:
        print("  No records found in quarantine_exemptions.\n")

    # 3. Check Audit Logs for quarantine events (toggle, start, lift)
    audits = await db['audit_logs'].find({"$or": [{"action": {"$regex": "quarantine", "$options": "i"}}, {"after.is_quarantined": {"$exists": True}}]}).to_list(100)
    print(f"3. AUDIT LOGS FOR QUARANTINE ({len(audits)} records):")
    for a in audits:
        print(f"  - Timestamp: {a.get('created_at')} | Action: {a.get('action')} | Actor: {a.get('actor_id')}")
        print(f"    Before: {a.get('before')}")
        print(f"    After:  {a.get('after')}\n")
    if not audits:
        print("  No quarantine audit logs found.\n")

    # 4. Check Census Events mentioning quarantine
    census = await db['census_events'].find({"$or": [{"reason": {"$regex": "quarantine", "$options": "i"}}, {"notes": {"$regex": "quarantine", "$options": "i"}}]}).to_list(100)
    print(f"4. CENSUS EVENTS MENTIONING QUARANTINE ({len(census)} records):")
    for c in census:
        print(f"  - Date: {c.get('date')} | Event: {c.get('event_type')} | Change: {c.get('change')} | Reason: {c.get('reason')}")
    if not census:
        print("  No census events mentioning quarantine found.\n")

if __name__ == '__main__':
    asyncio.run(check_quarantine())
