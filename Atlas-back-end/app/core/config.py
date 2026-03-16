"""
core/config.py — ATLAS Configuration

All settings are typed and loaded from environment variables / .env via
pydantic-settings.  lru_cache guarantees the .env file is parsed exactly
once per process.

Changes vs previous version:
  - Added seed_admin_* / seed_analyst_* / seed_readonly_* — credentials no
    longer hardcoded in auth_service.py or ingest_loghub.py.
  - Added allowed_cors_origins — replaces the "your-soc-frontend.com"
    hardcode in main.py.
  - Added startup_run_log_ingest — controls whether ingest_all_logs() is
    called on startup (replaces the ignored reingest_on_startup flag).
  - Added startup_warm_pandas_cache — controls warm_cache() call separately
    so CI/tests can skip the Pandas boot without also skipping DB ingest.
  - DATABASE_URL: validator raises a clear ValueError instead of letting
    asyncpg throw an opaque NoneType error.
"""

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):

    # ── Application ───────────────────────────────────────────────────────────
    app_name: str = "ATLAS"
    app_env: str  = "development"
    debug: bool   = True

    # ── PostgreSQL ────────────────────────────────────────────────────────────
    database_url: str = ""
    database_url_sync: str = ""

    db_pool_size: int     = 10
    db_max_overflow: int  = 20
    db_pool_timeout: int  = 30
    db_echo_sql: bool     = False

    @field_validator("database_url", mode="after")
    @classmethod
    def _require_database_url(cls, v: str) -> str:
        if not v:
            raise ValueError(
                "DATABASE_URL is not set.  "
                "Add it to your .env file, e.g.:\n"
                "  DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/atlas"
            )
        return v

    # ── Seed credentials (replaces hardcoded strings in auth_service.py) ─────
    # These are read once at startup — change them in .env before first boot.
    seed_admin_email:    str = "admin@atlas.com"
    seed_admin_password: str = "AtlasAdmin1!"
    seed_admin_name:     str = "ATLAS Administrator"

    seed_analyst_email:    str = "analyst@atlas.com"
    seed_analyst_password: str = "Analyst123!"
    seed_analyst_name:     str = "Jane Doe"

    seed_readonly_email:    str = "audit@atlas.com"
    seed_readonly_password: str = "ReadOnly123!"
    seed_readonly_name:     str = "Auditor External"

    # ── CORS (replaces "your-soc-frontend.com" hardcode in main.py) ──────────
    # Comma-separated list used when debug=False.
    # Example: "http://localhost:3000,https://soc.yourcompany.com"
    allowed_cors_origins: str = "http://localhost:3000"

    def get_cors_origins(self) -> List[str]:
        """Returns the parsed CORS origin list for CORSMiddleware."""
        if self.debug:
            return ["*"]
        return [o.strip() for o in self.allowed_cors_origins.split(",") if o.strip()]

    # ── Startup sequence flags ────────────────────────────────────────────────
    # startup_run_log_ingest: call ingest_all_logs() on startup.
    #   True  — dev / first-boot: seeds incidents + alerts into PostgreSQL.
    #   False — prod: rely on Vector/Fluent Bit hot path; skip re-ingest.
    startup_run_log_ingest: bool = True

    # startup_warm_pandas_cache: call warm_cache() on startup.
    #   True  — normal operation.
    #   False — CI / unit tests that don't have CSV files mounted.
    startup_warm_pandas_cache: bool = True

    # ── Log Ingestion ─────────────────────────────────────────────────────────
    log_data_dir: str = "data/logs"

    # ── Velociraptor ──────────────────────────────────────────────────────────
    velociraptor_webhook_secret: str = "change_me_in_production"
    velociraptor_api_url: str        = "https://localhost:8001"
    velociraptor_api_key: str        = ""

    # ── Wazuh ─────────────────────────────────────────────────────────────────
    wazuh_api_url:  str = "https://127.0.0.1:55000"
    wazuh_username: str = "wazuh-wui"
    wazuh_password: str = "lkt7zI?aDP1eGXqOW10h8fuV69rp0xpz"

    # ── Ollama LLM Copilot ────────────────────────────────────────────────────
    ollama_base_url: str = "http://localhost:11434"
    ollama_model:    str = "llama3"

    # ── Security / JWT ────────────────────────────────────────────────────────
    secret_key: str                   = "CHANGE_ME_SUPER_SECRET_KEY_FOR_JWT_SIGNING"
    algorithm: str                    = "HS256"
    access_token_expire_minutes: int  = 60

    # ── Risk Thresholds ───────────────────────────────────────────────────────
    risk_warn_threshold: int           = 1
    risk_soft_limit_threshold: int     = 3
    risk_hard_block_threshold: int     = 5
    anomaly_score_threshold: float     = -0.1

    # ── HTTP Ingest Endpoint ──────────────────────────────────────────────────
    ingest_api_key: str         = "CHANGE_ME_GENERATE_WITH_SECRETS_TOKEN_URLSAFE_48"
    ingest_api_key_header: str  = "X-Atlas-API-Key"
    ingest_max_batch_size: int  = 5_000

    # ── AWS S3 Cold-Storage ───────────────────────────────────────────────────
    s3_enabled: bool             = False
    aws_access_key_id: str       = ""
    aws_secret_access_key: str   = ""
    aws_region: str              = "us-east-1"
    s3_log_bucket: str           = "atlas-soc-cold-logs"
    s3_log_prefix: str           = "logs/"
    s3_poll_interval_seconds: int = 300
    s3_max_keys_per_poll: int    = 50

    class Config:
        env_file        = ".env"
        case_sensitive  = False


@lru_cache()
def get_settings() -> Settings:
    """Returns a cached singleton Settings instance."""
    return Settings()


def get_log_data_dir() -> Path:
    """Resolves the log data directory to an absolute path."""
    settings = get_settings()
    p = Path(settings.log_data_dir)
    if not p.is_absolute():
        p = Path(__file__).resolve().parent.parent.parent / p
    return p
