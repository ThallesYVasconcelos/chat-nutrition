from functools import lru_cache
from typing import Any, Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["local", "production"] = "local"
    app_base_url: str | None = None
    database_url: str | None = None
    supabase_db_url_local: str | None = None
    supabase_db_url_production: str | None = None
    supabase_url: str | None = None
    supabase_anon_key: str | None = None

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
    return Settings(**_load_streamlit_secrets())


def _load_streamlit_secrets() -> dict[str, Any]:
    """Read flat Streamlit secrets when running inside Streamlit.

    Scripts keep using `.env`; the Streamlit app can use `.streamlit/secrets.toml`
    locally or the Streamlit Cloud secrets panel in production.
    """
    try:
        import streamlit as st
        from streamlit.errors import StreamlitSecretNotFoundError
    except Exception:
        return {}

    key_map = {
        "APP_ENV": "app_env",
        "APP_BASE_URL": "app_base_url",
        "DATABASE_URL": "database_url",
        "SUPABASE_DB_URL_LOCAL": "supabase_db_url_local",
        "SUPABASE_DB_URL_PRODUCTION": "supabase_db_url_production",
        "SUPABASE_URL": "supabase_url",
        "SUPABASE_ANON_KEY": "supabase_anon_key",
        "EMBEDDING_PROVIDER": "embedding_provider",
        "LOCAL_EMBEDDING_MODEL": "local_embedding_model",
        "EMBEDDING_DIMENSIONS": "embedding_dimensions",
        "REPLICATE_API_TOKEN": "replicate_api_token",
        "REPLICATE_CHAT_MODEL": "replicate_chat_model",
        "REPLICATE_MAX_COMPLETION_TOKENS": "replicate_max_completion_tokens",
        "NUTRI_DOC_MATCH_COUNT": "nutri_doc_match_count",
        "NUTRI_DOC_MATCH_THRESHOLD": "nutri_doc_match_threshold",
    }
    values: dict[str, Any] = {}
    try:
        for secret_key, setting_key in key_map.items():
            if secret_key in st.secrets:
                value = st.secrets[secret_key]
                values[setting_key] = value.strip() if isinstance(value, str) else value
    except (FileNotFoundError, StreamlitSecretNotFoundError, RuntimeError):
        return {}
    return values
