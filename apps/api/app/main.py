from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .db import init_db
from .routers import auth, users, facilities, dashboard, reports, audit
from .routers import water_quality_logs, incident_reports
from .routers import projects, census, transfers, intake, species, quarantine, individual_fish, export
from .routers import notifications
from .routers import app_updates
from .services import notification_scheduler
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from .core.limiter import limiter
from fastapi.responses import JSONResponse
from fastapi.requests import Request

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Generates facility notifications on an interval, starting with a pass on
    # boot so a container that has just spun back up serves a current feed.
    notification_scheduler.start(app)
    try:
        yield
    finally:
        await notification_scheduler.stop(app)

app = FastAPI(title="ACare API", lifespan=lifespan)


# Clean up configured origins (strip quotes, whitespace, and trailing slashes)
configured_origins = [
    o.strip().strip("'\"").rstrip("/")
    for o in settings.CORS_ORIGINS.split(",")
    if o.strip()
]

# Default allowed production origins for resilience
default_origins = [
    "https://uwindsor-accs.vercel.app",
]

# Combine and deduplicate allowed origins
allowed_origins = list(set(configured_origins + default_origins))

# Regex matching local dev servers and any Vercel domain (*.vercel.app)
origin_regex = r"https?://(localhost|127\.0\.0\.1)(:\d+)?|https://.*\.vercel\.app"

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=origin_regex,
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
app.include_router(notifications.router)
app.include_router(app_updates.router)


