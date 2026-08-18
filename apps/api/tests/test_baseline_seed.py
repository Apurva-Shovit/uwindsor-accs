import pytest
from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.db import BASELINE_ROOM_NUMBER, ensure_baseline_facility
from app.models.facility import Facility, Room, Tank

DB_NAME = "acare-mvp-baseline-seed-test"


@pytest.fixture
async def scratch_db():
    """Point Beanie at a throwaway database so seeding cannot touch dev data."""
    client = AsyncIOMotorClient(settings.MONGO_URI)
    await client.drop_database(DB_NAME)
    await init_beanie(database=client[DB_NAME], document_models=[Facility, Room, Tank])
    yield
    await client.drop_database(DB_NAME)
    client.close()


@pytest.mark.asyncio
async def test_seeding_is_idempotent(scratch_db):
    _, first = await ensure_baseline_facility()
    _, second = await ensure_baseline_facility()

    assert first.id == second.id
    assert await Room.find_all().count() == 1
    assert await Tank.find_all().count() == 14


@pytest.mark.asyncio
async def test_renamed_room_is_not_seeded_twice(scratch_db):
    """A renamed pilot room must not read as a missing room.

    The room was renamed from "301" to "1" in production. Looking it up by
    number made the next boot seed a second room plus a duplicate set of 14
    tanks, which is the bug this guards.
    """
    _, room = await ensure_baseline_facility()
    room.room_number = "301"
    await room.save()

    _, found = await ensure_baseline_facility()

    assert found.id == room.id, "renamed room should be reused, not duplicated"
    assert await Room.find_all().count() == 1
    assert await Tank.find_all().count() == 14


@pytest.mark.asyncio
async def test_retired_tanks_are_not_resurrected(scratch_db):
    _, room = await ensure_baseline_facility()
    tank = await Tank.find_one({"room_id": str(room.id), "tank_number": "7"})
    tank.deleted = True
    await tank.save()

    await ensure_baseline_facility()

    assert await Tank.find_all().count() == 14
    still_deleted = await Tank.get(tank.id)
    assert still_deleted.deleted is True


@pytest.mark.asyncio
async def test_soft_deleted_room_is_replaced(scratch_db):
    _, room = await ensure_baseline_facility()
    room.deleted = True
    await room.save()

    _, fresh = await ensure_baseline_facility()

    assert fresh.id != room.id
    assert fresh.room_number == BASELINE_ROOM_NUMBER
    assert await Tank.find({"room_id": str(fresh.id)}).count() == 14
