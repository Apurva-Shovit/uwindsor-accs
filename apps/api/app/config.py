from pydantic import ConfigDict
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    MONGO_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "acare-mvp"
    SECRET_KEY: str = "super-secret-key-change-in-prod-123456789"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_HOURS: int = 12
    # Lifetime of a token issued with "Remember me". There is no server-side
    # revocation, so this is also the worst-case window in which a stolen token
    # stays usable — shorten it if devices are shared between shifts.
    REMEMBER_ME_EXPIRE_DAYS: int = 30
    ENABLE_INDIVIDUAL_FISH_TRACKING: bool = False

    RATE_LIMIT_LOGIN: str = "5/minute"
    RATE_LIMIT_DATA_ENTRY: str = "60/minute"
    RATE_LIMIT_ADMIN: str = "30/minute"

    # Notification thresholds. The facility timezone is what "server time" means
    # to the people reading the alerts — the API itself runs on UTC in
    # production, so a bare 17:00 UTC deadline would fire at lunchtime in
    # Windsor. Everything time-of-day sensitive resolves through this zone.
    FACILITY_TIMEZONE: str = "America/Toronto"
    WATER_QUALITY_DEADLINE_HOUR: int = 17          # 5 PM facility time
    WATER_QUALITY_MISSING_LOOKBACK_DAYS: int = 7   # how far back the panel keeps missed days
    QUARANTINE_EXPIRY_WARNING_DAYS: int = 1
    AUPP_EXPIRY_WARNING_DAYS: int = 30

    CORS_ORIGINS: str = ""  # comma-separated extra allowed origins, e.g. "https://acare-mvp.vercel.app"

    model_config = ConfigDict(env_file=".env", extra="ignore")

settings = Settings()

