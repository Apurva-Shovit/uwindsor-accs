from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, status
from ..models.user import User, AuditLog, RoleEnum
from ..models.project import Project
from ..models.tank_assignment import TankAssignment
from ..models.census_event import CensusEvent
from ..models.incident_report import IncidentReport
from ..schemas.project import ProjectCreate, ProjectClose
from ..repositories.base_repository import BaseRepository
from ..repositories.audit_repository import AuditRepository

class ProjectService:
    """Service layer for Project Management."""

    @staticmethod
    async def create_project(body: ProjectCreate, current_user: User) -> Project:
        dob_dt = datetime.fromisoformat(body.dob) if body.dob else None
        est_dt = datetime.fromisoformat(body.established_date) if body.established_date else None
        exp_dt = datetime.fromisoformat(body.aupp_expiry_date) if body.aupp_expiry_date else None

        existing_project = await Project.find_one({"aupp_number": body.aupp_number})
        if existing_project:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"A project with AUPP number '{body.aupp_number}' already exists.")

        project = Project(
            title=body.title,
            pi_name=body.pi_name,
            aupp_number=body.aupp_number,
            species=body.species,
            sex=body.sex,
            dob=dob_dt,
            established_date=est_dt,
            source=body.source,
            aupp_expiry_date=exp_dt,
            room_number=body.room_number,
            rfid_tracking_enabled=body.rfid_tracking_enabled,
            created_by=str(current_user.id),
        )

        await project.insert()

        after = project.model_dump(mode="json")
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=str(current_user.role.value if current_user.role else "none"),
            action="create",
            entity_type="project",
            entity_id=str(project.id),
            before=None,
            after=after,
        ))
        
        return project

    @staticmethod
    async def get_projects_overview(current_user: User) -> Dict[str, Any]:
        projects = await Project.find_all().to_list()
        assignments = await TankAssignment.find({"current_count": {"$gt": 0}}).to_list()
        incidents = await IncidentReport.find_all().to_list()
        census_events = await CensusEvent.find_all().to_list()

        now = datetime.now(timezone.utc)
        summaries = []
        expiring_count = 0

        for p in projects:
            p_id = str(p.id)
            p_assignments = [a for a in assignments if a.project_id == p_id]
            p_incidents = [inc for inc in incidents if inc.project_id == p_id]
            p_census = [c for c in census_events if c.project_id == p_id]

            current_fish = sum(c.change for c in p_census)
            current_fish = max(0, current_fish)
            mortality = sum(abs(c.change) for c in p_census if c.event_type == "death")

            is_expiring = False
            if p.aupp_expiry_date and p.status == "active":
                exp_date = p.aupp_expiry_date
                if exp_date.tzinfo is None:
                    exp_date = exp_date.replace(tzinfo=timezone.utc)
                if exp_date <= now + timedelta(days=30):
                    is_expiring = True
                    expiring_count += 1

            summaries.append({
                "id": p_id,
                "title": p.title,
                "pi_name": p.pi_name,
                "aupp_number": p.aupp_number,
                "species": p.species or "Unspecified",
                "status": p.status,
                "aupp_expiry_date": p.aupp_expiry_date.isoformat() if p.aupp_expiry_date else None,
                "is_expiring": is_expiring,
                "assigned_tanks_count": len(p_assignments),
                "total_animals": current_fish,
                "total_incidents": len(p_incidents),
                "total_mortality": mortality,
                "room_number": p.room_number or "-",
                "created_at": p.created_at.isoformat() if p.created_at else None,
            })

        active_count = sum(1 for p in projects if p.status == "active")

        return {
            "total_projects": len(projects),
            "active_projects": active_count,
            "closed_projects": len(projects) - active_count,
            "expiring_soon": expiring_count,
            "projects": summaries
        }

    @staticmethod
    async def close_project(project_id: str, body: ProjectClose, current_user: User) -> Project:
        p = await Project.get(project_id)
        if not p:
            raise HTTPException(404, "Project not found")

        if p.status == "closed":
            raise HTTPException(409, "Project already closed")

        before = p.model_dump(mode="json")

        p.status = "closed"
        p.closed_at = datetime.now(timezone.utc)
        p.closed_by = str(current_user.id)
        p.disposition_type = body.disposition_type
        p.disposition_notes = body.notes
        await p.save()

        active_assignments = await TankAssignment.find({
            "project_id": str(p.id),
            "current_count": {"$gt": 0}
        }).to_list()

        if active_assignments:
            event_mapping = {
                "euthanized": "death",
                "transferred_external": "transfer_out",
                "adopted": "transfer_out",
                "other": "manual_adjustment"
            }
            census_type = event_mapping.get(body.disposition_type, "manual_adjustment")
            reason = f"Project Closed: {body.disposition_type.capitalize()}"

            for ta in active_assignments:
                ev = CensusEvent(
                    tank_id=ta.tank_id,
                    tank_assignment_id=str(ta.id),
                    project_id=str(p.id),
                    event_type=census_type,
                    change=-ta.current_count,
                    reason=reason,
                    notes=body.notes,
                    date=datetime.now(timezone.utc).date(),
                    created_by=str(current_user.id)
                )
                await ev.insert()
                
                ta.current_count = 0
                await ta.save()

        after = p.model_dump(mode="json")
        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=str(current_user.role.value if current_user.role else "none"),
            action="close",
            entity_type="project",
            entity_id=str(p.id),
            before=before,
            after=after,
        ))
        
        return p
