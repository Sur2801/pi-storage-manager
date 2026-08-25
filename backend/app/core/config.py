from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../.env", env_file_encoding="utf-8")

    storage_root: str = "/home/pi/test-storage"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    api_prefix: str = "/api"


settings = Settings()
