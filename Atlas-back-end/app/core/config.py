"""
core/config.py — ATLAS Configuration (PostgreSQL + Velociraptor Stack)

Replaces the previous Elasticsearch / Wazuh configuration.
All settings are typed and loaded from .env via pydantic-settings.
lru_cache guarantees the .env file is parsed exactly once per process.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings
import os
from dotenv import load_dotenv

load_dotenv()  # Load .env file into environment variables at startup

class Settings(BaseSettings):
    # ── Application ───────────────────────────────────────────────────────────
    app_name: str = "ATLAS"
    app_env: str = "development"
    debug: bool = True

    # ── PostgreSQL ────────────────────────────────────────────────────────────
    # Format: postgresql+asyncpg://user:password@host:port/dbname
    database_url: str = os.environ.get("DATABASE_URL")

    # Synchronous URL is used only by Alembic migrations — never in async handlers
    database_url_sync: str = os.environ.get("DATABASE_URL_SYNC")

    # SQLAlchemy connection pool tuning
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout: int = 30
    db_echo_sql: bool = False  # Set True only for SQL debugging; never in prod

    # ── Log Ingestion ─────────────────────────────────────────────────────────
    # Directory where raw log files are stored (relative to project root)
    log_data_dir: str = "data/logs"

    # Re-ingest logs on every startup (useful in dev; set False in prod)
    reingest_on_startup: bool = True

    # ── Velociraptor (future live integration) ────────────────────────────────
    velociraptor_webhook_secret: str = "change_me_in_production"
    velociraptor_api_url: str = "https://localhost:8001"  # gRPC API endpoint
    velociraptor_api_key: str = ""                         # API key / cert path

    # Wazuh
    wazuh_api_url: str = "https://localhost:55000"
    wazuh_username: str = "wazuh"
    wazuh_password: str = "wazuh_password"

    # ── Ollama LLM Copilot (optional — gracefully degraded if unavailable) ────
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3"

    # ── Security / JWT ────────────────────────────────────────────────────────
    secret_key: str = "CHANGE_ME_SUPER_SECRET_KEY_FOR_JWT_SIGNING"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    # ── Risk Thresholds ───────────────────────────────────────────────────────
    risk_warn_threshold: int = 1
    risk_soft_limit_threshold: int = 3
    risk_hard_block_threshold: int = 5
    anomaly_score_threshold: float = -0.1

    # ── HTTP Ingest Endpoint (Vector / Fluent Bit / custom producers) ─────────
    # The static API key that must be supplied in the X-Atlas-API-Key header.
    # Generate with: python -c "import secrets; print(secrets.token_urlsafe(48))"
    ingest_api_key: str = "CHANGE_ME_GENERATE_WITH_SECRETS_TOKEN_URLSAFE_48"

    # Header name clients must use to pass the API key.
    ingest_api_key_header: str = "X-Atlas-API-Key"

    # Hard cap on records accepted per single POST batch (DoS protection).
    ingest_max_batch_size: int = 5_000

    # ── AWS S3 Cold-Storage Ingestion ─────────────────────────────────────────
    # Set s3_enabled=True to activate the background polling task.
    s3_enabled: bool = False

    # AWS credentials — prefer IAM instance roles / ECS task roles in production.
    # Leave blank when running on EC2/ECS with an attached IAM role.
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"

    # The S3 bucket that holds archived log batches.
    s3_log_bucket: str = "atlas-soc-cold-logs"

    # Only objects whose key starts with this prefix will be ingested.
    # Example: "logs/2024/" to replay a specific month's archive.
    s3_log_prefix: str = "logs/"

    # How often (in seconds) the background task checks for new S3 objects.
    s3_poll_interval_seconds: int = 300   # 5 minutes

    # Maximum number of S3 objects to download per poll cycle.
    # Prevents a backlog of millions of objects from overwhelming the DB.
    s3_max_keys_per_poll: int = 50

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """
    Returns a cached singleton Settings instance.
    Calling get_settings() multiple times in async handlers is free.
    """
    return Settings()


def get_log_data_dir() -> Path:
    """Resolves the log data directory to an absolute path."""
    settings = get_settings()
    p = Path(settings.log_data_dir)
    if not p.is_absolute():
        # Resolve relative to the project root (two levels up from this file)
        p = Path(__file__).resolve().parent.parent.parent / p
    return p
