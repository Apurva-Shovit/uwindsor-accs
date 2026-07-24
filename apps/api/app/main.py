from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .db import init_db
from .routers import auth, users, facilities, dashboard, reports, audit
from .routers import water_quality_logs, incident_reports
from .routers import projects, census, transfers, intake, species, quarantine, individual_fish

app = FastAPI(title="ACare API")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/health")
async def health():
    return {"status": "ok"}

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(facilities.router)
app.include_router(water_quality_logs.router)
app.include_router(incident_reports.router)
app.include_router(projects.router)
app.include_router(census.router)
app.include_router(transfers.router)
app.include_router(intake.router)
app.include_router(species.router)
app.include_router(dashboard.router)
app.include_router(reports.router)
app.include_router(audit.router)
app.include_router(quarantine.router)
app.include_router(individual_fish.router)


