from typing import List, Dict, Any, Optional
from fastapi import HTTPException, status
from ..models.user import User, AuditLog, RoleEnum
from ..models.water_quality_log import WaterQualityLog
from ..models.tank_assignment import TankAssignment
from ..schemas.water_quality import WaterQualityCreate, WaterQualityBatchCreate
from ..repositories.audit_repository import AuditRepository
from ..constants.water_quality import validate_parameters

MANAGER_PLUS = {RoleEnum.manager, RoleEnum.chair, RoleEnum.admin, RoleEnum.super_admin}

class WaterQualityService:
    """Service layer for Water Quality Logs."""

    @staticmethod
    def _authorize(user: User, tank_id: str) -> None:
        if user.role in MANAGER_PLUS:
            return
        if tank_id not in (user.assigned_tank_ids or []):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised to log for this tank")

    @staticmethod
    async def _get_project_id(tank_id: str) -> Optional[str]:
        ta = await TankAssignment.find_one({"tank_id": tank_id, "current_count": {"$gt": 0}})
        return ta.project_id if ta else None

    @staticmethod
    async def create_log(body: WaterQualityCreate, current_user: User) -> Dict[str, Any]:
        WaterQualityService._authorize(current_user, body.tank_id)
        project_id = await WaterQualityService._get_project_id(body.tank_id)

        log = WaterQualityLog(
            tank_id=body.tank_id,
            project_id=project_id,
            type=body.type,
            date=body.date,
            parameters=body.parameters,
            comments=body.comments,
            created_by=str(current_user.id),
        )
        await log.insert()
        after = log.model_dump(mode="json")

        await AuditRepository.insert(AuditLog(
            actor_id=str(current_user.id),
            actor_role=str(current_user.role.value if current_user.role else "none"),
            action="create",
            entity_type="water_quality_log",
            entity_id=str(log.id),
            before=None,
            after=after,
        ))

        validation = validate_parameters(body.type, body.parameters)
        return {"message": "created", "log": after, "validation": validation}

    @staticmethod
    async def create_batch_logs(body: WaterQualityBatchCreate, current_user: User) -> Dict[str, Any]:
        if not body.tank_ids:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "tank_ids cannot be empty")

        for tank_id in body.tank_ids:
            WaterQualityService._authorize(current_user, tank_id)

        created_logs = []
        for tank_id in body.tank_ids:
            project_id = await WaterQualityService._get_project_id(tank_id)
            log = WaterQualityLog(
                tank_id=tank_id,
                project_id=project_id,
                type=body.type,
                date=body.date,
                parameters=body.parameters,
                comments=body.comments,
                created_by=str(current_user.id),
            )
            await log.insert()
            after = log.model_dump(mode="json")
            
            await AuditRepository.insert(AuditLog(
                actor_id=str(current_user.id),
                actor_role=str(current_user.role.value if current_user.role else "none"),
                action="create",
                entity_type="water_quality_log",
                entity_id=str(log.id),
                before=None,
                after=after,
            ))
            created_logs.append(after)

        validation = validate_parameters(body.type, body.parameters)
        return {"created": len(created_logs), "logs": created_logs, "validation": validation}

    @staticmethod
    async def list_logs(tank_id: Optional[str], current_user: User) -> List[WaterQualityLog]:
        query: dict = {}
        if tank_id:
            query["tank_id"] = tank_id
            
        if current_user.role == RoleEnum.staff:
            if tank_id and tank_id not in (current_user.assigned_tank_ids or []):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised")
                
        return await WaterQualityLog.find(query).sort("-created_at").to_list()
