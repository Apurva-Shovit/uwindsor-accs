from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    MONGO_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "acare-mvp"
    SECRET_KEY: str = "super-secret-key-change-in-prod-123456789"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_HOURS: int = 12
    ENABLE_INDIVIDUAL_FISH_TRACKING: bool = False

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
