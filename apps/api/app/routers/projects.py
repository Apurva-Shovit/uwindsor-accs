from fastapi import APIRouter, Depends, HTTPException, status
from ..models.user import User
from ..models.project import Project
from ..core.permissions import get_current_user, require_manager_plus
from ..schemas.project import ProjectCreate, ProjectClose
from ..services.project_service import ProjectService

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", status_code=201)
async def create_project(
    body: ProjectCreate,
    current: User = Depends(require_manager_plus),
):
    return await ProjectService.create_project(body, current)


@router.get("/overview")
async def get_projects_overview(current: User = Depends(get_current_user)):
    return await ProjectService.get_projects_overview(current)


@router.get("")
async def list_projects(current: User = Depends(get_current_user)):
    return await Project.find_all().to_list()



@router.get("/{id}/details")
async def get_project_details(id: str, current: User = Depends(get_current_user)):
    return await ProjectService.get_project_details(id)


@router.get("/{id}/report")
async def get_project_report(
    id: str, 
    time_period: str = "all", 
    page: int = 1, 
    limit: int = 10,
    current: User = Depends(get_current_user)
):
    return await ProjectService.get_project_report(id, current, time_period=time_period, page=page, limit=limit)


@router.get("/{id}")
async def get_project(id: str, current: User = Depends(get_current_user)):
    p = await Project.get(id)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.post("/{id}/close")
async def close_project(
    id: str,
    body: ProjectClose,
    current: User = Depends(require_manager_plus),
):
    return await ProjectService.close_project(id, body, current)
