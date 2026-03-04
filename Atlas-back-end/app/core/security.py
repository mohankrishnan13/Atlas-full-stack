"""
core/security.py — Ingest API Key Authentication

Provides a reusable FastAPI dependency that enforces static API key
authentication for the log ingest endpoints.

Design decisions:
  - Static API key (not JWT) is intentional for machine-to-machine ingestion.
    Tools like Vector, Fluent Bit, and Logstash authenticate once per pipeline
    restart — they don't refresh tokens. A static key stored in the tool's
    config / secrets manager is the standard pattern.
  - `hmac.compare_digest` prevents timing-oracle attacks that could leak
    information about the key through response-time differences.
  - The key is read from settings (environment variable) at dependency-call
    time via `get_settings()`, which is lru_cached — zero overhead.
  - Failed authentication is always logged with the requester's IP for audit.

To rotate the key:
  1. Set INGEST_API_KEY to the new value in .env / your secrets manager.
  2. Restart the ATLAS backend (settings are lru_cached at process start).
  3. Update the key in your Vector / Fluent Bit config and restart those too.
"""

import hmac
import logging

from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import APIKeyHeader

from app.core.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# Declares the header FastAPI will extract and pass to the dependency.
# auto_error=False lets us craft a more informative error response ourselves.
_api_key_header_scheme = APIKeyHeader(
    name=settings.ingest_api_key_header,
    auto_error=False,
    description=(
        "Static API key for machine-to-machine log ingestion. "
        "Pass the key in the `X-Atlas-API-Key` request header."
    ),
)


async def require_ingest_api_key(
    request: Request,
    api_key: str | None = Security(_api_key_header_scheme),
) -> str:
    """
    FastAPI dependency — raises HTTP 401/403 if the API key is absent or wrong.

    Usage in route handlers:
        @router.post("/api/ingest/http")
        async def ingest(
            payload: IngestBatch,
            _key: str = Depends(require_ingest_api_key),
        ):
            ...

    Returns the validated key string so callers can log it (partial, for audit).
    """
    client_ip = request.client.host if request.client else "unknown"

    # ── Missing header ────────────────────────────────────────────────────────
    if not api_key:
        logger.warning(
            f"[AUTH] Ingest request rejected — missing API key header "
            f"'{settings.ingest_api_key_header}' from {client_ip}"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                f"Authentication required. "
                f"Provide your API key in the '{settings.ingest_api_key_header}' header."
            ),
            headers={"WWW-Authenticate": f"ApiKey header={settings.ingest_api_key_header}"},
        )

    # ── Wrong key (constant-time comparison) ──────────────────────────────────
    if not hmac.compare_digest(
        api_key.encode("utf-8"),
        settings.ingest_api_key.encode("utf-8"),
    ):
        # Log only the first 6 characters of the supplied key to help diagnose
        # "wrong environment" mistakes without leaking the real key.
        redacted = api_key[:6] + "…" if len(api_key) > 6 else "***"
        logger.warning(
            f"[AUTH] Ingest request rejected — invalid API key '{redacted}' "
            f"from {client_ip}"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key.",
        )

    logger.debug(f"[AUTH] Ingest API key accepted from {client_ip}")
    return api_key
