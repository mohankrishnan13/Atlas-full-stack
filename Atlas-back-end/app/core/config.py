"""
core/config.py — ATLAS Configuration

All runtime settings are loaded from environment variables / .env using
pydantic-settings. The configuration is parsed once per process via lru_cache.

Security guarantees
──────────────────
• Every secret has NO default value.
• Placeholder values are rejected.
• The application refuses to start if required secrets are missing.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load .env from project root
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

# ────────────────────────────────────────────────────────────────
# Placeholder protection
# ────────────────────────────────────────────────────────────────

_KNOWN_PLACEHOLDERS: frozenset[str] = frozenset(
    {
        "change_me",
        "changeme",
        "change_me_in_production",
        "password",
        "secret",
        "todo",
        "fixme",
        "your_password_here",
    }
)


def _reject_placeholder(field_name: str, value: str) -> str:
    if value.lower() in _KNOWN_PLACEHOLDERS:
        raise ValueError(
            f"{field_name} contains placeholder value '{value}'. "
            "Set a real secret in .env before starting ATLAS."
        )
    return value


# ────────────────────────────────────────────────────────────────
# Settings model
# ────────────────────────────────────────────────────────────────


class Settings(BaseSettings):
    """Central configuration object for ATLAS."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ─────────────────────────────────────────────────────────────
    # Application
    # ─────────────────────────────────────────────────────────────

    app_name: str = "ATLAS"
    app_env: str = "development"
    debug: bool = True

    # ─────────────────────────────────────────────────────────────
    # Database
    # ─────────────────────────────────────────────────────────────

    database_url: str
    database_url_sync: str = ""

    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout: int = 30
    db_echo_sql: bool = False

    @field_validator("database_url", mode="after")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        if not v:
            raise ValueError("DATABASE_URL must be set in .env")
        return v

    # ─────────────────────────────────────────────────────────────
    # Seed users
    # ─────────────────────────────────────────────────────────────

    seed_admin_email: str = "admin@atlas.com"
    seed_admin_password: str
    seed_admin_name: str = "ATLAS Administrator"

    seed_analyst_email: str = "analyst@atlas.com"
    seed_analyst_password: str
    seed_analyst_name: str = "SOC Analyst"

    seed_readonly_email: str = "audit@atlas.com"
    seed_readonly_password: str
    seed_readonly_name: str = "External Auditor"

    @field_validator(
        "seed_admin_password",
        "seed_analyst_password",
        "seed_readonly_password",
        mode="after",
    )
    @classmethod
    def validate_seed_passwords(cls, v: str, info):
        return _reject_placeholder(info.field_name, v)

    # ─────────────────────────────────────────────────────────────
    # CORS
    # ─────────────────────────────────────────────────────────────

    allowed_cors_origins: str = "http://localhost:3000"

    def get_cors_origins(self) -> List[str]:
        if self.debug:
            return ["*"]
        return [x.strip() for x in self.allowed_cors_origins.split(",")]

    # ─────────────────────────────────────────────────────────────
    # JWT Security
    # ─────────────────────────────────────────────────────────────

    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    @field_validator("secret_key", mode="after")
    @classmethod
    def validate_secret_key(cls, v: str):
        return _reject_placeholder("SECRET_KEY", v)

    # ─────────────────────────────────────────────────────────────
    # HTTP Log ingestion
    # ─────────────────────────────────────────────────────────────

    ingest_api_key: str
    ingest_api_key_header: str = "X-Atlas-API-Key"
    ingest_max_batch_size: int = 5000

    @field_validator("ingest_api_key", mode="after")
    @classmethod
    def validate_ingest_key(cls, v: str):
        return _reject_placeholder("INGEST_API_KEY", v)

    # ─────────────────────────────────────────────────────────────
    # Wazuh API (Manager REST API)
    # ─────────────────────────────────────────────────────────────

    wazuh_api_url: str
    wazuh_username: str
    wazuh_password: str

    wazuh_verify_ssl: bool = False
    wazuh_ca_bundle: str = ""

    @field_validator("wazuh_password", mode="after")
    @classmethod
    def validate_wazuh_password(cls, v: str):
        return _reject_placeholder("WAZUH_PASSWORD", v)

    # ─────────────────────────────────────────────────────────────
    # Wazuh Indexer (alerts storage)
    # ─────────────────────────────────────────────────────────────

    wazuh_indexer_url: str
    wazuh_indexer_username: str
    wazuh_indexer_password: str

    wazuh_indexer_verify_ssl: bool = False
    wazuh_indexer_ca_bundle: str = ""

    @field_validator("wazuh_indexer_password", mode="after")
    @classmethod
    def validate_indexer_password(cls, v: str):
        return _reject_placeholder("WAZUH_INDEXER_PASSWORD", v)

    # ─────────────────────────────────────────────────────────────
    # Velociraptor
    # ─────────────────────────────────────────────────────────────

    velociraptor_webhook_secret: str
    velociraptor_api_url: str = ""
    velociraptor_api_key: str = ""

    @field_validator("velociraptor_webhook_secret", mode="after")
    @classmethod
    def validate_velo_secret(cls, v: str):
        return _reject_placeholder("VELOCIRAPTOR_WEBHOOK_SECRET", v)

    # ─────────────────────────────────────────────────────────────
    # LLM Copilot
    # ─────────────────────────────────────────────────────────────

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3"

    # ─────────────────────────────────────────────────────────────
    # Risk scoring
    # ─────────────────────────────────────────────────────────────

    risk_warn_threshold: int = 1
    risk_soft_limit_threshold: int = 3
    risk_hard_block_threshold: int = 5
    anomaly_score_threshold: float = -0.1

    # ─────────────────────────────────────────────────────────────
    # AWS S3 cold storage
    # ─────────────────────────────────────────────────────────────

    s3_enabled: bool = False
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"

    s3_log_bucket: str = "atlas-soc-cold-logs"
    s3_log_prefix: str = "logs/"
    s3_poll_interval_seconds: int = 300
    s3_max_keys_per_poll: int = 50

    # ─────────────────────────────────────────────────────────────
    # Log storage
    # ─────────────────────────────────────────────────────────────

    log_data_dir: str = "data/logs"

    # Helper property
    @property
    def wazuh_alerts_index(self) -> str:
        return "wazuh-alerts-*"


# ────────────────────────────────────────────────────────────────
# Cached settings loader
# ────────────────────────────────────────────────────────────────


@lru_cache()
def get_settings() -> Settings:
    """Returns cached Settings instance."""
    return Settings()


# ────────────────────────────────────────────────────────────────
# Path helpers
# ────────────────────────────────────────────────────────────────


def get_log_data_dir() -> Path:
    settings = get_settings()

    p = Path(settings.log_data_dir)

    if not p.is_absolute():
        p = Path(__file__).resolve().parent.parent.parent / p

    return p