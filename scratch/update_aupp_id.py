import sys, os
sys.path.insert(0, os.path.abspath('.'))
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from apps.api.app.config import settings

def replace_in_obj(obj, target="AUPP-2026-0628", replacement="26-01"):
    if isinstance(obj, str):
        return obj.replace(target, replacement)
    elif isinstance(obj, dict):
        return {k: replace_in_obj(v, target, replacement) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [replace_in_obj(elem, target, replacement) for elem in obj]
    else:
        return obj

async def update_aupp_in_all_dbs():
    client = AsyncIOMotorClient(settings.MONGO_URI)
    db_names = await client.list_database_names()
    print(f"Found databases: {db_names}")

    total_modified = 0
    target = "AUPP-2026-0628"
    replacement = "26-01"

    for db_name in db_names:
        if db_name in ['admin', 'config', 'local']:
            continue
        db = client[db_name]
        cols = await db.list_collection_names()
        for col_name in cols:
            col = db[col_name]
            cursor = col.find()
            async for doc in cursor:
                doc_id = doc["_id"]
                # Convert doc to string to check if target exists anywhere in doc
                doc_str = str(doc)
                if target in doc_str:
                    updated_doc = replace_in_obj(doc, target, replacement)
                    # Don't change _id
                    updated_doc["_id"] = doc_id
                    await col.replace_one({"_id": doc_id}, updated_doc)
                    print(f"Updated doc {doc_id} in {db_name}.{col_name}")
                    total_modified += 1

    print(f"\nTotal documents updated across all DBs: {total_modified}")

if __name__ == "__main__":
    asyncio.run(update_aupp_in_all_dbs())
