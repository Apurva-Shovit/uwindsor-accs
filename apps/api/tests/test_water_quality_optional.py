import pytest
import uuid
from datetime import date
from fastapi import HTTPException
from app.db import init_db
from app.models.water_quality_log import WaterQualityLog
from app.models.user import User, RoleEnum
from app.models.facility import Tank, Room, Facility
from app.schemas.water_quality import WaterQualityCreate, WaterQualityBatchCreate
from app.services.water_quality_service import WaterQualityService

@pytest.mark.asyncio
async def test_water_quality_optional_parameters():
    await init_db()

    fac = Facility(name="Test Fac WQ", active=True)
    await fac.insert()
    room = Room(facility_id=str(fac.id), room_number="WQ101", active=True)
    await room.insert()
    tank = Tank(room_id=str(room.id), tank_number="WQ-01", status="active", is_quarantined=False)
    await tank.insert()
    tank_id = str(tank.id)

    unique_email = f"staff_{uuid.uuid4()}@uwindsor.ca"
    user = User(
        first_name="WQ",
        last_name="Tester",
        email=unique_email,
        password_hash="fake",
        role=RoleEnum.manager,
        requested_role=RoleEnum.manager,
        assigned_tank_ids=[tank_id],
    )
    await user.insert()

    # 1. Log with pH alone
    body_ph = WaterQualityCreate(
        tank_id=tank_id,
        type="daily",
        date=date(2026, 9, 11),
        parameters={"ph": 7.4},
    )
    res_ph = await WaterQualityService.create_log(body_ph, user)
    assert res_ph["log"]["parameters"] == {"ph": 7.4}
    assert res_ph["validation"]["ph"]["in_range"] is True

    # 2. Log with Temperature alone
    body_temp = WaterQualityCreate(
        tank_id=tank_id,
        type="daily",
        date=date(2026, 9, 11),
        parameters={"temperature": 22.5},
    )
    res_temp = await WaterQualityService.create_log(body_temp, user)
    assert res_temp["log"]["parameters"] == {"temperature": 22.5}
    assert res_temp["validation"]["temperature"]["in_range"] is True

    # 3. Log with Dissolved Oxygen alone
    body_do = WaterQualityCreate(
        tank_id=tank_id,
        type="daily",
        date=date(2026, 9, 11),
        parameters={"dissolved_oxygen": 6.8},
    )
    res_do = await WaterQualityService.create_log(body_do, user)
    assert res_do["log"]["parameters"] == {"dissolved_oxygen": 6.8}
    assert res_do["validation"]["dissolved_oxygen"]["in_range"] is True

    # 4. Reject empty parameters dict
    body_empty = WaterQualityCreate(
        tank_id=tank_id,
        type="daily",
        date=date(2026, 9, 11),
        parameters={},
    )
    with pytest.raises(HTTPException) as exc_info:
        await WaterQualityService.create_log(body_empty, user)
    assert exc_info.value.status_code == 400
    assert "At least one water quality parameter" in exc_info.value.detail
