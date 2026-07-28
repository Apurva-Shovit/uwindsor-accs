import sys
import os
sys.path.insert(0, os.path.abspath('.'))

import asyncio
from datetime import date, datetime, timedelta, timezone
import random
from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie

from apps.api.app.config import settings
from apps.api.app.core.security import hash_password
from apps.api.app.models.user import User, AuditLog, RoleEnum, StatusEnum
from apps.api.app.models.facility import Facility, Room, Tank
from apps.api.app.models.species import Species
from apps.api.app.models.project import Project
from apps.api.app.models.tank_assignment import TankAssignment
from apps.api.app.models.census_event import CensusEvent
from apps.api.app.models.water_quality_log import WaterQualityLog
from apps.api.app.models.incident_report import IncidentReport
from apps.api.app.models.quarantine import QuarantineExemption
from apps.api.app.models.individual_fish import IndividualFish

async def seed_data():
    print(f"Connecting to MongoDB at {settings.MONGO_URI} ({settings.MONGODB_DB_NAME})...")
    client = AsyncIOMotorClient(settings.MONGO_URI)
    await init_beanie(
        database=client[settings.MONGODB_DB_NAME],
        document_models=[
            User, AuditLog, Facility, Room, Tank,
            WaterQualityLog, IncidentReport, Project,
            TankAssignment, CensusEvent, Species,
            IndividualFish, QuarantineExemption
        ]
    )

    # 1. Ensure Facility & Room exist
    fac = await Facility.find_one({"name": "LaSalle Freshwater Restoration Ecology Centre"})
    if not fac:
        fac = Facility(name="LaSalle Freshwater Restoration Ecology Centre", address="LaSalle, ON", description="Main restoration ecology facility")
        await fac.insert()
    
    room = await Room.find_one({"facility_id": str(fac.id), "room_number": "301"})
    if not room:
        room = Room(facility_id=str(fac.id), room_number="301", description="Main aquatic holding room")
        await room.insert()

    # Ensure 14 Tanks exist
    tanks_dict = {}
    for i in range(1, 15):
        t_num = str(i)
        t = await Tank.find_one({"room_id": str(room.id), "tank_number": t_num})
        if not t:
            t = Tank(room_id=str(room.id), tank_number=t_num, status="active", notes=f"Tank {t_num}")
            await t.insert()
        tanks_dict[t_num] = t

    print(f"Facility: {fac.id}, Room: {room.id}, Tanks count: {len(tanks_dict)}")

    # 2. Users Setup
    # Users requested:
    # trevorp@uwindsor.ca = chair (password: admin)
    # manager1@uwindsor.ca = manager (password: admin)
    # staff1@uwindsor.ca = staff (password: admin)
    # staff2@uwindsor.ca = staff (password: admin)
    # superadmin@uwindsor.ca = super_admin (password: ChangeMe123!)

    user_specs = [
        ("superadmin@uwindsor.ca", "Super", "Admin", RoleEnum.super_admin, "ChangeMe123!"),
        ("trevorp@uwindsor.ca", "Trevor", "Pitcher", RoleEnum.chair, "admin"),
        ("manager1@uwindsor.ca", "Facility", "Manager", RoleEnum.manager, "admin"),
        ("staff1@uwindsor.ca", "Alex", "Staff", RoleEnum.staff, "admin"),
        ("staff2@uwindsor.ca", "Sam", "Technician", RoleEnum.staff, "admin"),
    ]

    users_by_email = {}
    for email, fname, lname, role, pwd in user_specs:
        u = await User.find_one({"email": email})
        if not u:
            u = User(
                email=email,
                password_hash=hash_password(pwd),
                first_name=fname,
                last_name=lname,
                requested_role=role,
                role=role,
                status=StatusEnum.active,
                facility_ids=[str(fac.id)],
                room_ids=[str(room.id)],
                assigned_tank_ids=[]
            )
            await u.insert()
            print(f"Created user: {email} ({role})")
        else:
            u.password_hash = hash_password(pwd)
            u.first_name = fname
            u.last_name = lname
            u.role = role
            u.requested_role = role
            u.status = StatusEnum.active
            u.facility_ids = [str(fac.id)]
            u.room_ids = [str(room.id)]
            await u.save()
            print(f"Updated user: {email} ({role})")
        users_by_email[email] = u

    # Delete any users not in the requested list
    all_users = await User.find_all().to_list()
    for u in all_users:
        if u.email not in users_by_email:
            await u.delete()
            print(f"Deleted unneeded user: {u.email}")

    # 3. Species Setup
    species = await Species.find_one({"name": "Yellow Perch"})
    if not species:
        species = Species(
            name="Yellow Perch",
            created_by=users_by_email["trevorp@uwindsor.ca"].id
        )
        await species.insert()
        print(f"Created species: {species.name}")

    # Clear previous timeline records to seed clean, coherent timeline
    await Project.delete_all()
    await TankAssignment.delete_all()
    await CensusEvent.delete_all()
    await WaterQualityLog.delete_all()
    await IncidentReport.delete_all()
    await QuarantineExemption.delete_all()
    await AuditLog.delete_all()

    # 4. Create Project (Trevor, Dated June 28th 2026 - Expiring June 28th 2027, population tracking)
    start_dt = datetime(2026, 6, 28, 9, 0, 0, tzinfo=timezone.utc)
    end_dt = datetime(2027, 6, 28, 23, 59, 59, tzinfo=timezone.utc)
    
    project = Project(
        title="Lake Erie Yellow Perch Restoration Study",
        pi_name="Trevor Pitcher",
        aupp_number="AUPP-2026-0628",
        status="active",
        created_by=str(users_by_email["trevorp@uwindsor.ca"].id),
        created_at=start_dt,
        rfid_tracking_enabled=False,
        species="Yellow Perch",
        established_date=start_dt,
        aupp_expiry_date=end_dt,
        room_number="301"
    )
    await project.insert()
    print(f"Created Project: '{project.title}' (ID: {project.id}) by Trevor Pitcher on June 28, 2026")

    # Audit log for project creation
    await AuditLog(
        actor_id=str(users_by_email["trevorp@uwindsor.ca"].id),
        actor_role=RoleEnum.chair,
        action="project_create",
        entity_type="project",
        entity_id=str(project.id),
        after={"title": project.title, "pi_name": project.pi_name, "aupp_number": project.aupp_number},
        created_at=start_dt
    ).insert()

    # 5. Day 2 (June 29, 2026): Staff adds census entry in Tank 1 (+100 fish) and quarantines Tank 1
    tank1 = tanks_dict["1"]
    tank1.is_quarantined = True
    tank1.quarantine_start_date = datetime(2026, 6, 29, 10, 0, 0, tzinfo=timezone.utc)
    tank1.quarantine_end_date = None
    tank1.status = "active"
    tank1.notes = "Quarantined intake - 100 Yellow Perch"
    await tank1.save()

    # Tank assignment for Tank 1
    assignment_t1 = TankAssignment(
        project_id=str(project.id),
        tank_id=str(tank1.id),
        current_count=100,
        pi_name=project.pi_name,
        aupp_number=project.aupp_number,
        created_by=str(users_by_email["staff1@uwindsor.ca"].id),
        created_at=datetime(2026, 6, 29, 10, 0, 0, tzinfo=timezone.utc)
    )
    await assignment_t1.insert()

    # Initial Census Event (+100)
    census_intake = CensusEvent(
        project_id=str(project.id),
        tank_assignment_id=str(assignment_t1.id),
        tank_id=str(tank1.id),
        date=date(2026, 6, 29),
        event_type="arrival",
        change=100,
        reason="Initial Intake & Quarantine Setup",
        created_by=str(users_by_email["staff1@uwindsor.ca"].id),
        created_at=datetime(2026, 6, 29, 10, 15, 0, tzinfo=timezone.utc)
    )
    await census_intake.insert()
    print("June 29: Staff1 added 100 fish to Tank 1 and initiated 14-day quarantine.")

    # 6. Mortality Events during Quarantine (June 29 - July 13)
    # July 5: 2 deaths in Tank 1 -> count 98
    c_july5 = CensusEvent(
        project_id=str(project.id),
        tank_assignment_id=str(assignment_t1.id),
        tank_id=str(tank1.id),
        date=date(2026, 7, 5),
        event_type="death",
        change=-2,
        reason="Acclimatization Mortality",
        created_by=str(users_by_email["staff1@uwindsor.ca"].id),
        created_at=datetime(2026, 7, 5, 14, 30, 0, tzinfo=timezone.utc)
    )
    await c_july5.insert()
    assignment_t1.current_count = 98
    await assignment_t1.save()

    # July 11: 1 death in Tank 1 -> count 97
    c_july11 = CensusEvent(
        project_id=str(project.id),
        tank_assignment_id=str(assignment_t1.id),
        tank_id=str(tank1.id),
        date=date(2026, 7, 11),
        event_type="death",
        change=-1,
        reason="Lesion Mortality",
        created_by=str(users_by_email["staff2@uwindsor.ca"].id),
        created_at=datetime(2026, 7, 11, 16, 0, 0, tzinfo=timezone.utc)
    )
    await c_july11.insert()
    assignment_t1.current_count = 97
    await assignment_t1.save()

    # 7. Day 15 (July 13, 2026): Quarantine lifted after 14 days (June 29 to July 13)
    tank1.is_quarantined = False
    tank1.quarantine_end_date = datetime(2026, 7, 13, 11, 0, 0, tzinfo=timezone.utc)
    tank1.notes = "Quarantine cleared on July 13, 2026"
    await tank1.save()

    await AuditLog(
        actor_id=str(users_by_email["manager1@uwindsor.ca"].id),
        actor_role=RoleEnum.manager,
        action="tank_quarantine_toggle",
        entity_type="tank",
        entity_id=str(tank1.id),
        before={"is_quarantined": True},
        after={"is_quarantined": False},
        created_at=datetime(2026, 7, 13, 11, 0, 0, tzinfo=timezone.utc)
    ).insert()
    print("July 13: 14-day quarantine lifted for Tank 1.")

    # 8. Split fish into different tanks after quarantine (July 14, 2026):
    # Total remaining: 97 fish.
    # Split into: Tank 1 (32 fish), Tank 2 (32 fish), Tank 3 (33 fish).
    tank2 = tanks_dict["2"]
    tank3 = tanks_dict["3"]

    assignment_t1.current_count = 32
    await assignment_t1.save()

    assignment_t2 = TankAssignment(
        project_id=str(project.id),
        tank_id=str(tank2.id),
        current_count=32,
        pi_name=project.pi_name,
        aupp_number=project.aupp_number,
        created_by=str(users_by_email["staff1@uwindsor.ca"].id),
        created_at=datetime(2026, 7, 14, 9, 30, 0, tzinfo=timezone.utc)
    )
    await assignment_t2.insert()

    assignment_t3 = TankAssignment(
        project_id=str(project.id),
        tank_id=str(tank3.id),
        current_count=33,
        pi_name=project.pi_name,
        aupp_number=project.aupp_number,
        created_by=str(users_by_email["staff1@uwindsor.ca"].id),
        created_at=datetime(2026, 7, 14, 9, 45, 0, tzinfo=timezone.utc)
    )
    await assignment_t3.insert()

    # Census events for split on July 14
    await CensusEvent(
        project_id=str(project.id),
        tank_assignment_id=str(assignment_t1.id),
        tank_id=str(tank1.id),
        date=date(2026, 7, 14),
        event_type="transfer_out",
        change=-65,
        reason="Post-quarantine redistribution to Tank 2 and Tank 3",
        created_by=str(users_by_email["staff1@uwindsor.ca"].id),
        created_at=datetime(2026, 7, 14, 10, 0, 0, tzinfo=timezone.utc)
    ).insert()

    await CensusEvent(
        project_id=str(project.id),
        tank_assignment_id=str(assignment_t2.id),
        tank_id=str(tank2.id),
        date=date(2026, 7, 14),
        event_type="transfer_in",
        change=32,
        reason="Post-quarantine transfer from Tank 1",
        created_by=str(users_by_email["staff1@uwindsor.ca"].id),
        created_at=datetime(2026, 7, 14, 10, 15, 0, tzinfo=timezone.utc)
    ).insert()

    await CensusEvent(
        project_id=str(project.id),
        tank_assignment_id=str(assignment_t3.id),
        tank_id=str(tank3.id),
        date=date(2026, 7, 14),
        event_type="transfer_in",
        change=33,
        reason="Post-quarantine transfer from Tank 1",
        created_by=str(users_by_email["staff1@uwindsor.ca"].id),
        created_at=datetime(2026, 7, 14, 10, 30, 0, tzinfo=timezone.utc)
    ).insert()
    print("July 14: Fish split post-quarantine across Tank 1 (32), Tank 2 (32), and Tank 3 (33).")

    # 9. Additional Mortalities post-split (July 14 to July 28)
    # July 18: Tank 2 (-1) -> count 31
    await CensusEvent(
        project_id=str(project.id),
        tank_assignment_id=str(assignment_t2.id),
        tank_id=str(tank2.id),
        date=date(2026, 7, 18),
        event_type="death",
        change=-1,
        reason="Post-transfer mortality",
        created_by=str(users_by_email["staff2@uwindsor.ca"].id),
        created_at=datetime(2026, 7, 18, 15, 0, 0, tzinfo=timezone.utc)
    ).insert()
    assignment_t2.current_count = 31
    await assignment_t2.save()

    # July 22: Tank 3 (-1) -> count 32
    await CensusEvent(
        project_id=str(project.id),
        tank_assignment_id=str(assignment_t3.id),
        tank_id=str(tank3.id),
        date=date(2026, 7, 22),
        event_type="death",
        change=-1,
        reason="Natural mortality",
        created_by=str(users_by_email["staff1@uwindsor.ca"].id),
        created_at=datetime(2026, 7, 22, 11, 20, 0, tzinfo=timezone.utc)
    ).insert()
    assignment_t3.current_count = 32
    await assignment_t3.save()

    # July 25: Tank 1 (-1) -> count 31
    await CensusEvent(
        project_id=str(project.id),
        tank_assignment_id=str(assignment_t1.id),
        tank_id=str(tank1.id),
        date=date(2026, 7, 25),
        event_type="death",
        change=-1,
        reason="Routine mortality",
        created_by=str(users_by_email["staff2@uwindsor.ca"].id),
        created_at=datetime(2026, 7, 25, 14, 45, 0, tzinfo=timezone.utc)
    ).insert()
    assignment_t1.current_count = 31
    await assignment_t1.save()

    # Update assigned_tank_ids on users
    for email in ["staff1@uwindsor.ca", "staff2@uwindsor.ca", "manager1@uwindsor.ca"]:
        u = users_by_email[email]
        u.assigned_tank_ids = [str(tank1.id), str(tank2.id), str(tank3.id)]
        await u.save()

    # 10. Incident Reports across the 30 days
    incidents = [
        {
            "date": date(2026, 7, 4),
            "tank": tank1,
            "assignment": assignment_t1,
            "problem": "Minor lethargy observed in 3 specimens following initial intake acclimatization.",
            "treatment": "Increased aeration rate and temporary feeding pause.",
            "comments": "Fish resumed active swimming within 12 hours.",
            "aquatic": True, "vet": False, "researcher": True,
            "user": users_by_email["staff1@uwindsor.ca"]
        },
        {
            "date": date(2026, 7, 10),
            "tank": tank1,
            "assignment": assignment_t1,
            "problem": "Superficial skin lesion detected on 1 specimen during routine inspection.",
            "treatment": "Isolated specimen in observation dip, applied topical antiseptic solution.",
            "comments": "Veterinarian contacted for advisory assessment.",
            "aquatic": True, "vet": True, "researcher": True,
            "user": users_by_email["staff2@uwindsor.ca"]
        },
        {
            "date": date(2026, 7, 20),
            "tank": tank2,
            "assignment": assignment_t2,
            "problem": "Slight feed response reduction following tank split transfer.",
            "treatment": "Water parameter check and feed quantity adjusted.",
            "comments": "Parameters within safe thresholds. Behavior normal on evening check.",
            "aquatic": True, "vet": False, "researcher": True,
            "user": users_by_email["manager1@uwindsor.ca"]
        }
    ]

    for inc in incidents:
        dt_obj = datetime.combine(inc["date"], datetime.min.time()).replace(tzinfo=timezone.utc)
        ir = IncidentReport(
            project_id=str(project.id),
            tank_assignment_id=str(inc["assignment"].id),
            tank_id=str(inc["tank"].id),
            date=inc["date"],
            problem=inc["problem"],
            treatment=inc["treatment"],
            comments=inc["comments"],
            aquatic_condition_checked=inc["aquatic"],
            vet_contacted=inc["vet"],
            researcher_notified=inc["researcher"],
            created_by=str(inc["user"].id),
            created_at=dt_obj
        )
        await ir.insert()
        print(f"Created Incident Report for {inc['date']} in Tank {inc['tank'].tank_number} (Vet Contacted: {inc['vet']})")

    # 11. Daily Water Quality Records for EVERY day from June 28th to July 28th (31 days) for ALL 14 tanks
    start_date = date(2026, 6, 28)
    end_date = date(2026, 7, 28)
    current_date = start_date

    staff_users = [users_by_email["staff1@uwindsor.ca"], users_by_email["staff2@uwindsor.ca"], users_by_email["manager1@uwindsor.ca"]]
    logs_created = 0

    random.seed(42)  # Consistent realistic data

    while current_date <= end_date:
        # Day index for slight realistic temperature / pH drift
        day_idx = (current_date - start_date).days
        base_temp = 19.0 + (day_idx % 5) * 0.3 + random.uniform(-0.4, 0.4)
        base_ph = 7.3 + (day_idx % 4) * 0.1 + random.uniform(-0.1, 0.1)
        base_do = 8.2 - (day_idx % 6) * 0.1 + random.uniform(-0.2, 0.2)

        for t_num, t_obj in tanks_dict.items():
            author = staff_users[(day_idx + int(t_num)) % len(staff_users)]
            dt_log = datetime.combine(current_date, datetime.min.time()).replace(hour=8, minute=30, tzinfo=timezone.utc)

            # 1. Daily log (ph, temperature, dissolved_oxygen)
            ph_val = round(base_ph + random.uniform(-0.15, 0.15), 2)
            temp_val = round(base_temp + random.uniform(-0.3, 0.3), 2)
            do_val = round(base_do + random.uniform(-0.3, 0.3), 2)

            daily_log = WaterQualityLog(
                tank_id=str(t_obj.id),
                project_id=str(project.id) if t_num in ["1", "2", "3"] else None,
                type="daily",
                date=current_date,
                parameters={
                    "ph": ph_val,
                    "temperature": temp_val,
                    "dissolved_oxygen": do_val
                },
                comments="Routine morning parameter log" if day_idx % 7 == 0 else None,
                created_by=str(author.id),
                created_at=dt_log
            )
            await daily_log.insert()
            logs_created += 1

            # 2. Weekly Test Strip Log (every 6 days) for active project tanks
            if day_idx % 6 == 0 and t_num in ["1", "2", "3"]:
                test_strip_log = WaterQualityLog(
                    tank_id=str(t_obj.id),
                    project_id=str(project.id),
                    type="test_strip",
                    date=current_date,
                    parameters={
                        "nitrate": round(random.uniform(5.0, 15.0), 1),
                        "nitrite": 0.0,
                        "hardness": round(random.uniform(120.0, 180.0), 1),
                        "chlorine": 0.0,
                        "alkalinity": round(random.uniform(130.0, 160.0), 1),
                        "ph": ph_val,
                        "ammonia": round(random.uniform(0.0, 0.1), 2)
                    },
                    comments="Comprehensive weekly multi-parameter test strip verification",
                    created_by=str(author.id),
                    created_at=dt_log.replace(hour=14)
                )
                await test_strip_log.insert()
                logs_created += 1

        current_date += timedelta(days=1)

    print(f"\nTimeline Seeding Complete! Total Water Quality Logs created: {logs_created}")

if __name__ == "__main__":
    asyncio.run(seed_data())
