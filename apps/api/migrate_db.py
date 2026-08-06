import asyncio
import os
import sys
from motor.motor_asyncio import AsyncIOMotorClient

# Default local and atlas URIs
DEFAULT_LOCAL_URI = os.getenv("LOCAL_MONGO_URI", "mongodb://localhost:27017")
DEFAULT_ATLAS_URI = os.getenv("MONGO_URI", "")
DB_NAME = os.getenv("MONGODB_DB_NAME", "acare-mvp")

async def migrate(local_uri: str, atlas_uri: str, db_name: str = "acare-mvp", drop_existing: bool = True):
    print(f"Connecting to Local MongoDB: {local_uri}")
    local_client = AsyncIOMotorClient(local_uri)
    local_db = local_client[db_name]

    print(f"Connecting to Atlas MongoDB...")
    atlas_client = AsyncIOMotorClient(atlas_uri)
    atlas_db = atlas_client[db_name]

    # Test connections
    try:
        await local_client.admin.command('ping')
        print("Connected to Local MongoDB.")
    except Exception as e:
        print(f"Failed to connect to Local MongoDB: {e}")
        return

    try:
        await atlas_client.admin.command('ping')
        print("Connected to Atlas MongoDB.")
    except Exception as e:
        print(f"Failed to connect to Atlas MongoDB: {e}")
        return

    collections = await local_db.list_collection_names()
    user_collections = [c for c in collections if not c.startswith("system.")]

    print(f"\nFound {len(user_collections)} collections to migrate in '{db_name}': {user_collections}\n")

    total_docs_migrated = 0

    for coll_name in user_collections:
        local_coll = local_db[coll_name]
        atlas_coll = atlas_db[coll_name]

        count = await local_coll.count_documents({})
        if count == 0:
            print(f"Collection '{coll_name}': Empty (0 documents). Skipping.")
            continue

        docs = await local_coll.find({}).to_list(length=None)

        if drop_existing:
            await atlas_coll.delete_many({})
            print(f"Cleared existing data in Atlas collection '{coll_name}'.")

        if docs:
            # Insert in chunks of 500
            chunk_size = 500
            for i in range(0, len(docs), chunk_size):
                chunk = docs[i:i + chunk_size]
                await atlas_coll.insert_many(chunk)

            print(f"Collection '{coll_name}': Successfully migrated {len(docs)} documents.")
            total_docs_migrated += len(docs)

    print(f"\nMigration complete! Total documents migrated to Atlas: {total_docs_migrated}")

if __name__ == "__main__":
    atlas_uri = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ATLAS_URI
    if not atlas_uri:
        print("Usage: python migrate_db.py <ATLAS_MONGO_URI>")
        print("Or set MONGO_URI in environment / .env file.")
        sys.exit(1)

    drop_existing = "--merge" not in sys.argv
    asyncio.run(migrate(DEFAULT_LOCAL_URI, atlas_uri, DB_NAME, drop_existing=drop_existing))
