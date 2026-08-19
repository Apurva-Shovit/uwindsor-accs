"""Report data that the pre-atomic write paths could have corrupted.

Run this BEFORE the unique indexes in app/models/tank_assignment.py and
app/models/facility.py go live. Beanie builds indexes inside init_beanie during
boot, so a collection that already violates one of them stops the API from
starting at all -- on Render that is a failed deploy, not a warning.

Read-only. It never writes; anything it reports has to be resolved by hand (or
by scripts/reconcile_census.py --repair for the drift section).

Usage:
    python scripts/audit_concurrency_damage.py
    python scripts/audit_concurrency_damage.py --mongo-uri "mongodb+srv://..." --db acare-mvp
"""

import argparse
import asyncio
import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "apps", "api"))

from motor.motor_asyncio import AsyncIOMotorClient


def _client_kwargs(mongo_uri: str) -> dict:
    kwargs = {"serverSelectionTimeoutMS": 10000, "connectTimeoutMS": 10000}
    if "mongodb+srv://" in mongo_uri or "ssl=true" in mongo_uri.lower() or "tls=true" in mongo_uri.lower():
        import certifi
        kwargs["tlsCAFile"] = certifi.where()
    return kwargs


async def _duplicate_assignment_rows(db) -> list[dict]:
    """Two rows for one (tank_id, project_id) -- blocks the unique index."""
    return await db.tank_assignments.aggregate([
        {"$group": {
            "_id": {"tank_id": "$tank_id", "project_id": "$project_id"},
            "count": {"$sum": 1},
            "ids": {"$push": "$_id"},
            "counts": {"$push": "$current_count"},
        }},
        {"$match": {"count": {"$gt": 1}}},
    ]).to_list(length=None)


async def _multiply_occupied_tanks(db) -> list[dict]:
    """More than one occupied project in a tank -- blocks the partial unique index."""
    return await db.tank_assignments.aggregate([
        {"$match": {"current_count": {"$gt": 0}}},
        {"$group": {
            "_id": "$tank_id",
            "count": {"$sum": 1},
            "projects": {"$push": "$project_id"},
            "ids": {"$push": "$_id"},
        }},
        {"$match": {"count": {"$gt": 1}}},
    ]).to_list(length=None)


async def _negative_counts(db) -> list[dict]:
    return await db.tank_assignments.find({"current_count": {"$lt": 0}}).to_list(length=None)


async def _duplicate_tank_numbers(db) -> list[dict]:
    return await db.tanks.aggregate([
        {"$match": {"deleted": {"$ne": True}}},
        {"$group": {
            "_id": {"room_id": "$room_id", "tank_number": "$tank_number"},
            "count": {"$sum": 1},
            "ids": {"$push": "$_id"},
        }},
        {"$match": {"count": {"$gt": 1}}},
    ]).to_list(length=None)


async def _ledger_drift(db) -> list[dict]:
    """current_count vs sum(census_events.change) for the same assignment.

    The two have never been reconciled, so any lost update that already happened
    shows up here. quarantine_placed/lifted carry change=0 and cancel out.
    """
    sums = await db.census_events.aggregate([
        {"$group": {"_id": "$tank_assignment_id", "total": {"$sum": "$change"}}},
    ]).to_list(length=None)
    ledger = {row["_id"]: row["total"] for row in sums}

    drift = []
    async for ta in db.tank_assignments.find({}):
        assignment_id = str(ta["_id"])
        expected = ledger.get(assignment_id, 0)
        actual = ta.get("current_count", 0)
        if expected != actual:
            drift.append({
                "assignment_id": assignment_id,
                "tank_id": ta.get("tank_id"),
                "project_id": ta.get("project_id"),
                "current_count": actual,
                "ledger_total": expected,
                "delta": actual - expected,
            })
    return drift


async def audit(mongo_uri: str, db_name: str) -> int:
    print(f"Auditing {db_name} at {mongo_uri.split('@')[-1]}", flush=True)
    client = AsyncIOMotorClient(mongo_uri, **_client_kwargs(mongo_uri))
    db = client[db_name]

    blocking = 0

    dupes = await _duplicate_assignment_rows(db)
    print(f"\n[1] Duplicate (tank_id, project_id) assignments: {len(dupes)}")
    for d in dupes:
        blocking += 1
        print(f"    tank={d['_id']['tank_id']} project={d['_id']['project_id']} "
              f"rows={d['count']} counts={d['counts']} ids={[str(i) for i in d['ids']]}")

    occupied = await _multiply_occupied_tanks(db)
    print(f"\n[2] Tanks holding more than one occupied project: {len(occupied)}")
    for o in occupied:
        blocking += 1
        print(f"    tank={o['_id']} projects={o['projects']} ids={[str(i) for i in o['ids']]}")

    negatives = await _negative_counts(db)
    print(f"\n[3] Assignments with a negative count: {len(negatives)}")
    for n in negatives:
        blocking += 1
        print(f"    id={n['_id']} tank={n.get('tank_id')} count={n.get('current_count')}")

    tank_dupes = await _duplicate_tank_numbers(db)
    print(f"\n[4] Duplicate (room_id, tank_number) tanks: {len(tank_dupes)}")
    for t in tank_dupes:
        blocking += 1
        print(f"    room={t['_id']['room_id']} tank_number={t['_id']['tank_number']} "
              f"ids={[str(i) for i in t['ids']]}")

    drift = await _ledger_drift(db)
    print(f"\n[5] Assignments where current_count disagrees with the census ledger: {len(drift)}")
    for d in drift:
        print(f"    assignment={d['assignment_id']} tank={d['tank_id']} "
              f"count={d['current_count']} ledger={d['ledger_total']} drift={d['delta']:+d}")

    print("\n" + "=" * 72)
    if blocking:
        print(f"BLOCKING: {blocking} record(s) in sections 1-4 violate a unique index that is")
        print("about to be added. Resolve these before deploying, or the API will not boot.")
    else:
        print("Sections 1-4 clean -- the unique indexes can be added safely.")
    if drift:
        print(f"Section 5 reports {len(drift)} drifted assignment(s). These do not block the")
        print("index, but they are existing lost updates. Fix with:")
        print("    python scripts/reconcile_census.py --repair")
    print("=" * 72)

    client.close()
    return 1 if blocking else 0


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mongo-uri", default=os.getenv("MONGO_URI", "mongodb://localhost:27017"))
    parser.add_argument("--db", default=os.getenv("MONGODB_DB_NAME", "acare-mvp"))
    args = parser.parse_args()
    return asyncio.run(audit(args.mongo_uri, args.db))


if __name__ == "__main__":
    raise SystemExit(main())
