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

    # Seed values for the daily water quality deadline. These only apply the
    # first time the API starts against a database with no settings record —
    # after that the stored record is authoritative, because chairs and admins
    # edit the deadline from the app and a redeploy must not quietly reset it.
    WATER_QUALITY_DEADLINE_HOUR: int = 15          # 3 PM
    WATER_QUALITY_DEADLINE_MINUTE: int = 0
    # Named zone rather than a fixed offset so the cutoff stays at 3 PM as staff
    # experience it on both sides of the daylight-saving change.
    NOTIFICATION_TIMEZONE: str = "America/Toronto"

    WATER_QUALITY_MISSING_LOOKBACK_DAYS: int = 7   # how far back the panel keeps missed days
    QUARANTINE_EXPIRY_WARNING_DAYS: int = 1
    AUPP_EXPIRY_WARNING_DAYS: int = 30

    # How often the generator reconciles stored notifications against live data.
    # Each pass recomputes the whole lookback window, so a pass missed while the
    # service was spun down is backfilled by the next one.
    NOTIFICATION_SWEEP_INTERVAL_MINUTES: int = 15

    # --- Firebase Cloud Messaging -------------------------------------------
    # Push delivery to the Android app. Leave all of this unset and push is a
    # no-op: the in-app feed is unaffected, so an unconfigured deployment behaves
    # exactly as it did before push existed.
    #
    # Supply the service-account credentials one way or the other. Inline JSON is
    # what Render can actually hold; the file path is the sane option locally.
    FCM_SERVICE_ACCOUNT_JSON: str = ""
    FCM_SERVICE_ACCOUNT_FILE: str = ""
    # Must match the channel the Android app creates at startup — Android 8+
    # silently drops a message naming a channel that does not exist.
    FCM_ANDROID_CHANNEL_ID: str = "acare-alerts"

    CORS_ORIGINS: str = ""  # comma-separated extra allowed origins, e.g. "https://acare-mvp.vercel.app"

    model_config = ConfigDict(env_file=".env", extra="ignore")

settings = Settings()

