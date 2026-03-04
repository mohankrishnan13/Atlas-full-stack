"""
api/routes_ingest.py — HTTP Log Ingest Endpoint

Exposes POST /api/ingest/http for real-time or near-real-time log ingestion
from pipeline tools such as Vector, Fluent Bit, Logstash, or any custom
producer that can POST JSON.

Authentication:
  Static API key in the X-Atlas-API-Key header (see core/security.py).

Accepted payload format
-----------------------
Vector's `http` sink (and most other tools) sends either a JSON array or
a wrapped object. Both are supported:

  Option A — bare array (Vector default with `encoding.codec = "json"`):
    [
      { "log_type": "network", "env": "cloud", "source_ip": "1.2.3.4", ... },
      { "log_type": "endpoint", "env": "local", "workstation_id": "WKSTN-001", ... }
    ]

  Option B — wrapped object (useful for metadata passthrough):
    {
      "source":    "vector-agent-prod-01",
      "schema":    "atlas-v2",
      "logs": [
        { "log_type": "network", ... },
        ...
      ]
    }

Each log record MUST contain a `log_type` field with one of:
  "network" | "api" | "endpoint" | "db" | "incident" | "alert"

Records missing or with an unknown `log_type` are counted as rejected and
returned in the `errors` array — they do NOT abort the entire batch.

Response schema
---------------
  HTTP 202 Accepted:
  {
    "accepted":    42,           // records written to PostgreSQL
    "rejected":    2,            // records skipped due to parse errors
    "batch_size":  44,           // total records received
    "source":      "vector-prod",// echoed from payload if present
    "errors": [                  // details on rejected records (capped at 20)
      { "index": 7, "log_type": "unknown_type", "reason": "Unsupported log_type" }
    ]
  }

Vector configuration (vector.toml)
------------------------------------
See config/vector.toml in this repository for a ready-to-use Vector pipeline
that tails log files and ships them to this endpoint.
"""

import logging
from typing import Any, Dict, List, Union

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import require_ingest_api_key
from app.core.config import get_settings
from app.services.log_ingestion import (
    _parse_alert,
    _parse_api_log,
    _parse_db_activity_log,
    _parse_endpoint_log,
    _parse_incident,
    _parse_network_log,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/ingest", tags=["Log Ingestion"])

# ── Type → parser mapping ──────────────────────────────────────────────────────
# The `log_type` field in each incoming record selects the right ORM model.
_PARSERS = {
    "network":  _parse_network_log,
    "api":      _parse_api_log,
    "endpoint": _parse_endpoint_log,
    "db":       _parse_db_activity_log,
    "incident": _parse_incident,
    "alert":    _parse_alert,
}


# ── Request / response Pydantic models ────────────────────────────────────────

class IngestBatch(BaseModel):
    """
    Accepts both payload shapes from Vector and other producers.

    If `logs` is None, the route handler inspects the raw request body
    directly for a bare JSON array (Vector's default encoding).
    """
    source: str = Field(
        default="unknown",
        description="Identifier for the sending agent (e.g. 'vector-prod-01').",
        examples=["vector-prod-01", "fluent-bit-k8s"],
    )
    schema_version: str = Field(
        default="atlas-v2",
        alias="schema",
        description="Payload schema version for forward-compatibility checks.",
    )
    logs: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Array of log records. Each must contain a 'log_type' field.",
        max_length=5_001,   # enforced again at handler level; Pydantic first pass
    )

    @field_validator("logs")
    @classmethod
    def validate_batch_size(cls, v: list) -> list:
        max_size = get_settings().ingest_max_batch_size
        if len(v) > max_size:
            raise ValueError(
                f"Batch too large: {len(v)} records exceeds the maximum of {max_size}. "
                "Split into smaller batches."
            )
        return v

    class Config:
        populate_by_name = True     # allow both `schema` and `schema_version`


class RecordError(BaseModel):
    index: int
    log_type: str
    reason: str


class IngestResponse(BaseModel):
    accepted: int
    rejected: int
    batch_size: int
    source: str
    errors: List[RecordError] = []


# ── Route handler ─────────────────────────────────────────────────────────────

@router.post(
    "/http",
    response_model=IngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Batch ingest logs from Vector / Fluent Bit / custom producers",
    description=(
        "Accepts a JSON batch of log records and persists them to PostgreSQL. "
        "Requires the `X-Atlas-API-Key` header. "
        "Each record must include a `log_type` field: "
        "`network | api | endpoint | db | incident | alert`."
    ),
    response_description="Ingest summary: counts of accepted, rejected, and detailed errors.",
)
async def http_ingest(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _key: str = Depends(require_ingest_api_key),   # ← authentication gate
) -> IngestResponse:
    """
    Handles both bare-array and wrapped-object payloads from Vector.

    Processing is record-by-record with individual try/except blocks so that
    one malformed record never silently drops the rest of the batch.
    Records that fail are collected in `errors` (capped at 20 to keep the
    response payload bounded) and the batch continues.

    All accepted records are flushed to the DB in a single commit at the end
    for efficiency — avoid per-record commits under load.
    """
    client_ip = request.client.host if request.client else "unknown"

    # ── Step 1: Parse request body ────────────────────────────────────────────
    # Support both a bare JSON array and the wrapped IngestBatch object.
    try:
        raw_body = await request.json()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Request body is not valid JSON: {exc}",
        )

    if isinstance(raw_body, list):
        # Vector with encoding.codec = "json" sends a bare array
        log_records: List[Dict[str, Any]] = raw_body
        source = "unknown (bare-array payload)"
    elif isinstance(raw_body, dict):
        # Wrapped format: { "source": "...", "logs": [...] }
        try:
            batch = IngestBatch.model_validate(raw_body)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Payload validation failed: {exc}",
            )
        log_records = batch.logs
        source = batch.source
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload must be a JSON array or a JSON object with a 'logs' key.",
        )

    # ── Step 2: Hard batch-size cap ───────────────────────────────────────────
    if len(log_records) > settings.ingest_max_batch_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Batch size {len(log_records)} exceeds the server limit of "
                f"{settings.ingest_max_batch_size}. Split into smaller batches."
            ),
        )

    batch_size = len(log_records)
    logger.info(
        f"[INGEST] Received batch of {batch_size} records "
        f"from {client_ip} (source='{source}')"
    )

    # ── Step 3: Parse and accumulate ORM objects ──────────────────────────────
    orm_objects = []
    errors: List[RecordError] = []
    _max_errors_in_response = 20   # cap to keep HTTP response bounded

    for idx, record in enumerate(log_records):
        if not isinstance(record, dict):
            if len(errors) < _max_errors_in_response:
                errors.append(RecordError(
                    index=idx,
                    log_type="<non-dict>",
                    reason=f"Record is a {type(record).__name__}, expected a JSON object.",
                ))
            continue

        log_type = str(record.get("log_type", "")).strip().lower()
        parser = _PARSERS.get(log_type)

        if parser is None:
            if len(errors) < _max_errors_in_response:
                errors.append(RecordError(
                    index=idx,
                    log_type=log_type or "<missing>",
                    reason=(
                        f"Unknown or missing log_type '{log_type}'. "
                        f"Must be one of: {', '.join(_PARSERS.keys())}."
                    ),
                ))
            continue

        try:
            orm_objects.append(parser(record))
        except Exception as exc:
            if len(errors) < _max_errors_in_response:
                errors.append(RecordError(
                    index=idx,
                    log_type=log_type,
                    reason=f"Parse error: {exc}",
                ))

    # ── Step 4: Bulk-insert all valid records in a single commit ───────────────
    accepted = len(orm_objects)
    rejected = batch_size - accepted

    if orm_objects:
        db.add_all(orm_objects)
        await db.commit()

    logger.info(
        f"[INGEST] Batch complete — accepted={accepted} rejected={rejected} "
        f"source='{source}' client={client_ip}"
    )

    if errors:
        logger.warning(
            f"[INGEST] {rejected} records rejected in batch from '{source}'. "
            f"First error: {errors[0].model_dump()}"
        )

    return IngestResponse(
        accepted=accepted,
        rejected=rejected,
        batch_size=batch_size,
        source=source,
        errors=errors,
    )
