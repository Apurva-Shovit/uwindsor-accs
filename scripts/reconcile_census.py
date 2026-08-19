"""Report, and optionally repair, drift between fish counts and the census ledger.

TankAssignment.current_count is a mutable counter kept alongside the immutable
census_events ledger. They are supposed to agree. Where they do not, the ledger
wins -- it is append-only and audited.

Run in report mode after any incident, and after the manual concurrency check
in the plan, to confirm the two representations still line up.

Usage:
    python scripts/reconcile_census.py
    python scripts/reconcile_census.py --repair
    python scripts/reconcile_census.py --mongo-uri "mongodb+srv://..." --db acare-mvp
"""

import argparse
import asyncio
import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "apps", "api"))

from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.models.audit_log import AuditLog
from app.models.census_event import CensusEvent
from app.models.tank_assignment import TankAssignment
from app.utils.census_reconcile import find_drift, repair


def _client_kwargs(mongo_uri: str) -> dict:
    kwargs = {"serverSelectionTimeoutMS": 10000, "connectTimeoutMS": 10000}
    if "mongodb+srv://" in mongo_uri or "ssl=true" in mongo_uri.lower() or "tls=true" in mongo_uri.lower():
        import certifi
        kwargs["tlsCAFile"] = certifi.where()
    return kwargs


async def run(mongo_uri: str, db_name: str, do_repair: bool) -> int:
    client = AsyncIOMotorClient(mongo_uri, **_client_kwargs(mongo_uri))
    # Only the three collections this touches, so the script does not depend on
    # every model being loadable and cannot trigger index builds on the rest.
    await init_beanie(
        database=client[db_name],
        document_models=[TankAssignment, CensusEvent, AuditLog],
    )

    drifted = await find_drift()
    if not drifted:
        print(f"{db_name}: no drift - every count agrees with the census ledger.")
        client.close()
        return 0

    print(f"{db_name}: {len(drifted)} assignment(s) disagree with the ledger\n")
    for d in drifted:
        print("  " + d.describe())

    if not do_repair:
        print("\nReport only. Re-run with --repair to reset these counts to their")
        print("ledger totals (each correction is written to the audit log).")
        client.close()
        return 1

    print()
    repaired = await repair(drifted, actor_id="reconcile_census.py")
    print(f"Repaired {repaired} of {len(drifted)} assignment(s).")
    if repaired != len(drifted):
        print("The rest changed while the repair ran; re-run to pick them up.")

    client.close()
    return 0


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mongo-uri", default=os.getenv("MONGO_URI", "mongodb://localhost:27017"))
    parser.add_argument("--db", default=os.getenv("MONGODB_DB_NAME", "acare-mvp"))
    parser.add_argument(
        "--repair",
        action="store_true",
        help="reset drifted counts to their ledger totals",
    )
    args = parser.parse_args()
    return asyncio.run(run(args.mongo_uri, args.db, args.repair))


if __name__ == "__main__":
    raise SystemExit(main())
