from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["local", "production"] = "local"
    database_url: str | None = None
    supabase_db_url_local: str | None = None
    supabase_db_url_production: str | None = None

    embedding_provider: Literal["local"] = "local"
    local_embedding_model: str = "intfloat/multilingual-e5-small"
    embedding_dimensions: int = Field(default=384, ge=1)

    replicate_api_token: str | None = None
    replicate_chat_model: str = "openai/gpt-4o-mini"
    replicate_max_completion_tokens: int = Field(default=4096, ge=256, le=16384)

    nutri_doc_match_count: int = Field(default=6, ge=1, le=20)
    nutri_doc_match_threshold: float = Field(default=0.68, ge=0.0, le=1.0)

    @property
    def resolved_database_url(self) -> str:
        env_url = (
            self.supabase_db_url_production
            if self.app_env == "production"
            else self.supabase_db_url_local
        )
        url = env_url or self.database_url
        if not url:
            raise RuntimeError(
                "Configure SUPABASE_DB_URL_LOCAL, SUPABASE_DB_URL_PRODUCTION, or DATABASE_URL."
            )
        return url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
