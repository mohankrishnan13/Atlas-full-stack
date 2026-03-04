"""
api/routes_webhooks.py — Live Data Ingestion Webhooks

These endpoints receive real-time data from external security tools.

Current implementation:
  - POST /webhooks/velociraptor  — Receives live endpoint telemetry from
    Velociraptor agents. Authenticated via HMAC-SHA256 signature verification.

Future endpoints (see FUTURE_IMPLEMENTATION.md):
  - POST /webhooks/syslog        — Receives forwarded syslog events
  - POST /webhooks/kafka-batch   — Receives batches from a Kafka consumer bridge
"""

import hashlib
import hmac
import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.services.log_ingestion import ingest_velociraptor_event

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


def _verify_velociraptor_signature(
    body: bytes, signature: str | None, secret: str
) -> bool:
    """
    Verifies an HMAC-SHA256 signature sent by Velociraptor.

    Velociraptor signs the request body with the shared webhook secret.
    We recompute the HMAC and compare to prevent forged events.

    If no signature header is present and we are in debug mode, allow through
    (useful for local testing with curl). In production this MUST be enforced.
    """
    if signature is None:
        if settings.debug:
            logger.warning(
                "Velociraptor webhook received without signature. "
                "Allowing in debug mode — ENFORCE IN PRODUCTION."
            )
            return True
        return False

    expected = hmac.new(
        secret.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()

    # Constant-time comparison to prevent timing attacks
    return hmac.compare_digest(f"sha256={expected}", signature)


@router.post(
    "/velociraptor",
    status_code=202,
    summary="Receive live Velociraptor endpoint events",
    description=(
        "Accepts real-time artifact results pushed by Velociraptor server notifications. "
        "Requires HMAC-SHA256 signature in X-Velociraptor-Signature header. "
        "See FUTURE_IMPLEMENTATION.md for full setup guide."
    ),
)
async def receive_velociraptor_event(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_velociraptor_signature: str | None = Header(default=None, alias="X-Velociraptor-Signature"),
) -> Dict[str, Any]:
    """
    Velociraptor Webhook Receiver.

    Velociraptor sends POST requests here when a monitored artifact
    triggers on an endpoint. This route:
      1. Verifies the HMAC-SHA256 signature.
      2. Parses the payload into a VelociraptorWebhookPayload.
      3. Persists the event as an EndpointLog row via the ingestion service.
      4. Returns 202 Accepted immediately (do not block Velociraptor).

    Payload format:
    {
        "artifact": "Windows.Detection.Yara.Process",
        "client_id": "C.1234abcd",
        "session_id": "F.XXXX",
        "timestamp": "2024-05-21T10:45:00Z",
        "rows": [
            {
                "Username": "john.smith",
                "Message": "YARA match: Emotet dropper",
                "Severity": "Critical",
                "OS": "Windows 11"
            }
        ]
    }
    """
    # ── 1. Read raw body for signature verification ───────────────────────────
    body = await request.body()

    if not _verify_velociraptor_signature(
        body, x_velociraptor_signature, settings.velociraptor_webhook_secret
    ):
        logger.warning(
            "Velociraptor webhook rejected: invalid signature from "
            f"{request.client.host if request.client else 'unknown'}"
        )
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    # ── 2. Parse JSON payload ─────────────────────────────────────────────────
    try:
        payload: Dict[str, Any] = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON payload: {exc}")

    # ── 3. Persist event ──────────────────────────────────────────────────────
    client_id = payload.get("client_id", "UNKNOWN")
    artifact = payload.get("artifact", "Unknown")

    try:
        event = await ingest_velociraptor_event(payload, db)
        logger.info(
            f"Velociraptor event accepted: client={client_id} artifact={artifact} "
            f"db_id={event.id if event else 'none'}"
        )
    except Exception as exc:
        logger.error(f"Failed to persist Velociraptor event: {exc}", exc_info=True)
        # Return 202 anyway — we don't want to cause Velociraptor to retry
        # infinitely. Log the error and investigate separately.
        return {
            "status": "accepted_with_error",
            "client_id": client_id,
            "artifact": artifact,
            "error": str(exc),
        }

    return {
        "status": "accepted",
        "client_id": client_id,
        "artifact": artifact,
    }
