from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    storage_root: str = "/home/pi/test-storage"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    api_prefix: str = "/api"


settings = Settings()
