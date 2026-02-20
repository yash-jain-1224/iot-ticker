"""
Application configuration settings
"""
from pathlib import Path
from typing import List
from pydantic_settings import BaseSettings
from functools import lru_cache
from pydantic import field_validator


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    # Database
    DATABASE_URL: str = ""
    DATABASE_URL_SYNC: str = ""

    # Security
    SECRET_KEY: str = "your-super-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Kafka
    KAFKA_BOOTSTRAP_SERVERS: str = "localhost:9092"
    KAFKA_TOPIC_TELEMETRY: str = "iot-telemetry"
    KAFKA_TOPIC_EVENTS: str = "iot-events"
    KAFKA_CONSUMER_GROUP: str = "iot-ticker-backend"

    # MQTT
    MQTT_BROKER: str = "localhost"
    MQTT_PORT: int = 1883
    MQTT_USERNAME: str = ""
    MQTT_PASSWORD: str = ""

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # Databricks
    DATABRICKS_HOST: str = ""
    DATABRICKS_TOKEN: str = ""
    DATABRICKS_DASHBOARD_BASE_URL: str = ""
    DATABRICKS_PORT: int = 5432
    DATABRICKS_DATABASE: str = ""
    DATABRICKS_USER: str = ""
    DATABRICKS_PASSWORD: str = ""
    DATABRICKS_SCHEMA: str = ""
    DATABRICKS_SSL_MODE: str = "require"

    # PostgreSQL password passthrough (optional)
    PGPASSWORD: str = ""

    # Environment
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173"]

    @field_validator("DATABASE_URL", "DATABASE_URL_SYNC", mode="before")
    @classmethod
    def _normalize_urls(cls, value: str, info) -> str:
        if not isinstance(value, str):
            return value
        sanitized = value.split("?")[0]
        if info.field_name == "DATABASE_URL":
            if sanitized.startswith("postgresql://"):
                return sanitized.replace("postgresql://", "postgresql+asyncpg://", 1)
            return sanitized
        if info.field_name == "DATABASE_URL_SYNC":
            if sanitized.startswith("postgresql+asyncpg://"):
                return sanitized.replace("postgresql+asyncpg://", "postgresql://", 1)
            return sanitized
        return sanitized

    @property
    def ASYNC_DATABASE_URL(self) -> str:
        return self.DATABASE_URL

    @property
    def SYNC_DATABASE_URL(self) -> str:
        return self.DATABASE_URL_SYNC

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    class Config:
        env_file = Path(__file__).resolve().parents[2] / ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()


settings = get_settings()
