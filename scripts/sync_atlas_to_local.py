"""Replace the local database with a copy of a remote one.

Strictly one-directional: the source is only ever read from, and the
destination must be a localhost address. Pointing this at a deployed database
by mistake is the one failure that would matter, so the guard is a hard refusal
rather than a prompt.

Indexes are copied along with the documents. That is deliberate -- it makes the
local database a faithful rehearsal of a deploy, so booting the API against it
exercises the same index migration that will run in production instead of
building the current definitions from scratch.

Usage:
    python scripts/sync_atlas_to_local.py --source "mongodb+srv://..." --yes-drop-local
    python scripts/sync_atlas_to_local.py --source "..." --source-db acare-mvp \\
        --dest mongodb://localhost:27017 --dest-db acare-mvp --yes-drop-local
"""

import argparse
import asyncio
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

BATCH = 500

# Anything outside this set is treated as a deployed database and refused.
LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "mongo"}


def _client_kwargs(uri: str) -> dict:
    kwargs = {"serverSelectionTimeoutMS": 30000, "connectTimeoutMS": 30000}
    if "mongodb+srv://" in uri or "ssl=true" in uri.lower() or "tls=true" in uri.lower():
        import certifi
        kwargs["tlsCAFile"] = certifi.where()
    return kwargs


def assert_destination_is_local(uri: str) -> None:
    """Refuse to write anywhere that is not this machine."""
    if uri.startswith("mongodb+srv://"):
        raise SystemExit(
            "Refusing to run: the destination is an SRV connection string, which "
            "means a deployed cluster. This script only ever writes to localhost."
        )

    without_scheme = uri.split("://", 1)[-1]
    hostpart = without_scheme.split("/", 1)[0].split("?", 1)[0]
    if "@" in hostpart:
        raise SystemExit(
            "Refusing to run: the destination carries credentials, which a local "
            "development database does not need. This script only writes to localhost."
        )

    hosts = {h.rsplit(":", 1)[0].strip("[]") for h in hostpart.split(",") if h}
    unexpected = hosts - LOCAL_HOSTS
    if unexpected:
        raise SystemExit(
            f"Refusing to run: destination host(s) {sorted(unexpected)} are not local. "
            "This script only ever writes to localhost."
        )


async def copy_collection(src_db, dst_db, name: str) -> int:
    """Copy one collection's documents, then its index definitions."""
    copied = 0
    batch: list = []

    async for doc in src_db[name].find({}):
        batch.append(doc)
        if len(batch) >= BATCH:
            await dst_db[name].insert_many(batch, ordered=False)
            copied += len(batch)
            batch = []

    if batch:
        await dst_db[name].insert_many(batch, ordered=False)
        copied += len(batch)

    for index_name, spec in (await src_db[name].index_information()).items():
        if index_name == "_id_":
            continue  # created automatically
        options = {k: v for k, v in spec.items() if k not in ("key", "v", "ns")}
        try:
            await dst_db[name].create_index(
                [(field, direction) for field, direction in spec["key"]],
                name=index_name,
                **options,
            )
        except Exception as exc:
            # A source index that cannot be rebuilt locally is worth reporting,
            # but it must not abandon a sync that has already copied the data.
            print(f"    ! index {index_name}: {exc}")

    return copied


async def sync(source_uri: str, source_db_name: str, dest_uri: str, dest_db_name: str) -> int:
    assert_destination_is_local(dest_uri)

    src = AsyncIOMotorClient(source_uri, **_client_kwargs(source_uri))
    dst = AsyncIOMotorClient(dest_uri, **_client_kwargs(dest_uri))

    src_db = src[source_db_name]
    names = sorted(await src_db.list_collection_names())
    if not names:
        raise SystemExit(f"Source database '{source_db_name}' has no collections. Nothing to copy.")

    print(f"source      : {source_db_name} ({len(names)} collections)")
    print(f"destination : {dest_db_name} at {dest_uri}")
    print()

    # Drop the whole database rather than the collections we are about to write,
    # so nothing that exists only locally survives the overwrite.
    print(f"Dropping local database '{dest_db_name}'...")
    await dst.drop_database(dest_db_name)
    dst_db = dst[dest_db_name]

    total = 0
    for name in names:
        copied = await copy_collection(src_db, dst_db, name)
        total += copied
        print(f"  {name:28} {copied:>7}")

    print(f"\nCopied {total} documents into {dest_db_name}.")

    # Read the destination back rather than trusting the write counts.
    print("\nVerifying...")
    mismatches = 0
    for name in names:
        expected = await src_db[name].count_documents({})
        actual = await dst_db[name].count_documents({})
        if expected != actual:
            mismatches += 1
            print(f"  MISMATCH {name}: source {expected}, local {actual}")
    if mismatches:
        print(f"\n{mismatches} collection(s) did not copy cleanly.")
    else:
        print("  every collection matches the source count.")

    src.close()
    dst.close()
    return 1 if mismatches else 0


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="source connection string (read-only)")
    parser.add_argument("--source-db", default=os.getenv("MONGODB_DB_NAME", "acare-mvp"))
    parser.add_argument("--dest", default="mongodb://localhost:27017")
    parser.add_argument("--dest-db", default=os.getenv("MONGODB_DB_NAME", "acare-mvp"))
    parser.add_argument(
        "--yes-drop-local",
        action="store_true",
        help="required: confirms the destination database is dropped first",
    )
    args = parser.parse_args()

    if not args.yes_drop_local:
        raise SystemExit(
            "Refusing to run without --yes-drop-local: this drops the destination "
            "database before copying."
        )

    return asyncio.run(sync(args.source, args.source_db, args.dest, args.dest_db))


if __name__ == "__main__":
    raise SystemExit(main())
