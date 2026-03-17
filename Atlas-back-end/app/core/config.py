"""
core/config.py — ATLAS Configuration

All settings are typed and loaded exclusively from environment variables / .env
via pydantic-settings.  lru_cache guarantees the .env file is parsed exactly
once per process.

Security contract
─────────────────
• Every secret / credential field has NO Python default.  The application will
  refuse to start — raising a clear ValidationError — if any required variable
  is absent from the environment.
• A sentinel validator additionally rejects known placeholder strings
  (e.g. "CHANGE_ME_…", "change_me_in_production") so an accidentally-committed
  .env.example value can never silently become a live credential.
• Non-sensitive tunables (pool sizes, timeouts, feature flags) retain safe
  defaults so deployments only need to supply the secrets they care about.

Required environment variables (no Python default)
──────────────────────────────────────────────────
  DATABASE_URL               postgresql+asyncpg://user:pass@host:5432/db
  SECRET_KEY                 JWT signing key — generate: python -c "import secrets; print(secrets.token_hex(32))"
  INGEST_API_KEY             Static API key  — generate: python -c "import secrets; print(secrets.token_urlsafe(48))"
  WAZUH_API_URL              Full base URL, e.g. https://10.10.5.142:55000
  WAZUH_USERNAME             Wazuh API user, e.g. wazuh-wui
  WAZUH_PASSWORD             Wazuh API password
  VELOCIRAPTOR_WEBHOOK_SECRET HMAC-SHA256 shared secret — generate: openssl rand -hex 32
  SEED_ADMIN_PASSWORD        Password for the bootstrapped Admin account
  SEED_ANALYST_PASSWORD      Password for the bootstrapped Analyst account
  SEED_READONLY_PASSWORD     Password for the bootstrapped Read-Only account
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# ─── Sentinel detection ───────────────────────────────────────────────────────
# Values in this set are rejected at startup so that placeholder strings from
# .env.example can never silently become real running credentials.
_KNOWN_PLACEHOLDERS: frozenset[str] = frozenset(
    {
        "change_me_in_production",
        "change_me_in_production_use_openssl_rand_hex_32",
        "change_me_super_secret_key_for_jwt_signing",
        "change_me_generate_with_secrets_token_urlsafe_48",
        "atlasadmin1!",
        "analyst123!",
        "readonly123!",
        "your_password_here",
        "changeme",
        "change",
        "secret",
        "password",
        "todo",
        "fixme",
    }
)


def _reject_placeholder(field_name: str, value: str) -> str:
    """Raises ValueError when *value* is a known placeholder string."""
    if value.lower() in _KNOWN_PLACEHOLDERS:
        raise ValueError(
            f"'{field_name}' contains a known placeholder value ('{value}'). "
            f"Set a real secret in your .env file before starting the application. "
            f"See .env.example for generation instructions."
        )
    return value


class Settings(BaseSettings):
    """
    Single source of truth for every runtime configuration value in ATLAS.

    Fields WITHOUT a default are REQUIRED — the application will refuse to
    start if they are absent or contain a known placeholder value.
    Fields with a default are safe tunables suitable for vanilla deployments.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ───────────────────────────────────────────────────────────
    app_name: str = "ATLAS"
    app_env: str = "development"
    debug: bool = True

    # ── PostgreSQL ────────────────────────────────────────────────────────────
    # REQUIRED — async URL for SQLAlchemy / FastAPI handlers.
    database_url: str
    # Optional — sync URL used only by Alembic CLI migrations.
    database_url_sync: str = ""

    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout: int = 30
    db_echo_sql: bool = False

    @field_validator("database_url", mode="after")
    @classmethod
    def _require_database_url(cls, v: str) -> str:
        if not v:
            raise ValueError(
                "DATABASE_URL is not set. "
                "Add it to your .env file, e.g.:\n"
                "  DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/atlas"
            )
        return v

    # ── Seed credentials — REQUIRED, no password defaults ────────────────────
    # Consumed once at first startup to bootstrap user accounts.
    # Override ALL THREE in .env before the very first boot.
    seed_admin_email: str = "admin@atlas.com"
    seed_admin_password: str  # REQUIRED
    seed_admin_name: str = "ATLAS Administrator"

    seed_analyst_email: str = "analyst@atlas.com"
    seed_analyst_password: str  # REQUIRED
    seed_analyst_name: str = "Jane Doe"

    seed_readonly_email: str = "audit@atlas.com"
    seed_readonly_password: str  # REQUIRED
    seed_readonly_name: str = "Auditor External"

    @field_validator(
        "seed_admin_password", "seed_analyst_password", "seed_readonly_password",
        mode="after",
    )
    @classmethod
    def _reject_placeholder_seed_passwords(cls, v: str, info) -> str:
        return _reject_placeholder(info.field_name, v)

    # ── CORS ──────────────────────────────────────────────────────────────────
    # Comma-separated list applied when debug=False.
    # Example: "http://localhost:3000,https://soc.yourcompany.com"
    allowed_cors_origins: str = "http://localhost:3000"

    def get_cors_origins(self) -> List[str]:
        """Returns the parsed CORS origin list for CORSMiddleware."""
        if self.debug:
            return ["*"]
        return [o.strip() for o in self.allowed_cors_origins.split(",") if o.strip()]

    # ── Startup sequence flags ────────────────────────────────────────────────
    # startup_run_log_ingest: True = seed incidents/alerts from JSONL on boot.
    #   Set to False in production — rely on the Vector/Fluent Bit hot path.
    startup_run_log_ingest: bool = True
    # startup_warm_pandas_cache: True = pre-load CSVs into Pandas on boot.
    #   Set to False in CI / unit tests that have no CSV files mounted.
    startup_warm_pandas_cache: bool = True

    # ── Log Ingestion ─────────────────────────────────────────────────────────
    log_data_dir: str = "data/logs"

    # ── Security / JWT — REQUIRED ─────────────────────────────────────────────
    # Generate: python -c "import secrets; print(secrets.token_hex(32))"
    secret_key: str  # REQUIRED
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    @field_validator("secret_key", mode="after")
    @classmethod
    def _reject_placeholder_secret_key(cls, v: str) -> str:
        return _reject_placeholder("SECRET_KEY", v)

    # ── HTTP Ingest Endpoint — REQUIRED ───────────────────────────────────────
    # Static API key for machine-to-machine ingest (Vector, Fluent Bit, etc.)
    # Generate: python -c "import secrets; print(secrets.token_urlsafe(48))"
    ingest_api_key: str  # REQUIRED
    ingest_api_key_header: str = "X-Atlas-API-Key"
    ingest_max_batch_size: int = 5_000

    @field_validator("ingest_api_key", mode="after")
    @classmethod
    def _reject_placeholder_ingest_key(cls, v: str) -> str:
        return _reject_placeholder("INGEST_API_KEY", v)

    # ── Wazuh — REQUIRED ─────────────────────────────────────────────────────
    # Set WAZUH_VERIFY_SSL=true and WAZUH_CA_BUNDLE=/path/to/ca.pem in
    # production once you replace the default self-signed certificate.
    wazuh_api_url: str   # REQUIRED — e.g. https://10.10.5.142:55000
    wazuh_username: str  # REQUIRED — e.g. wazuh-wui
    wazuh_password: str  # REQUIRED
    wazuh_verify_ssl: bool = False
    wazuh_ca_bundle: str = ""  # Path to CA bundle; ignored when verify_ssl=False

    @field_validator("wazuh_api_url", mode="after")
    @classmethod
    def _require_wazuh_url(cls, v: str) -> str:
        if not v:
            raise ValueError(
                "WAZUH_API_URL is not set. "
                "Example: WAZUH_API_URL=https://10.10.5.142:55000"
            )
        return v

    @field_validator("wazuh_password", mode="after")
    @classmethod
    def _reject_placeholder_wazuh_password(cls, v: str) -> str:
        return _reject_placeholder("WAZUH_PASSWORD", v)

    # ── Velociraptor — REQUIRED ───────────────────────────────────────────────
    # Generate: openssl rand -hex 32
    velociraptor_webhook_secret: str  # REQUIRED
    velociraptor_api_url: str = ""    # Optional; only needed when Velo is enabled
    velociraptor_api_key: str = ""    # Optional

    @field_validator("velociraptor_webhook_secret", mode="after")
    @classmethod
    def _reject_placeholder_velociraptor_secret(cls, v: str) -> str:
        return _reject_placeholder("VELOCIRAPTOR_WEBHOOK_SECRET", v)

    # ── Ollama LLM Copilot (optional) ─────────────────────────────────────────
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3"

    # ── Risk Thresholds ───────────────────────────────────────────────────────
    risk_warn_threshold: int = 1
    risk_soft_limit_threshold: int = 3
    risk_hard_block_threshold: int = 5
    anomaly_score_threshold: float = -0.1

    # ── AWS S3 Cold-Storage ───────────────────────────────────────────────────
    s3_enabled: bool = False
    # Leave blank to use IAM role / instance profile (recommended for production).
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    s3_log_bucket: str = "atlas-soc-cold-logs"
    s3_log_prefix: str = "logs/"
    s3_poll_interval_seconds: int = 300
    s3_max_keys_per_poll: int = 50


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
