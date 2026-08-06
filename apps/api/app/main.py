from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .db import init_db
from .routers import auth, users, facilities, dashboard, reports, audit
from .routers import water_quality_logs, incident_reports
from .routers import projects, census, transfers, intake, species, quarantine, individual_fish, export
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from .core.limiter import limiter
from fastapi.responses import JSONResponse
from fastapi.requests import Request

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(title="ACare API", lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Content-Security-Policy"] = "default-src 'self'"
    return response

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
app.include_router(export.router)


